import type { Feed, EntryListItem, SyncStatus } from '../../../shared/contracts/feed.types';
import { createFeedError } from '../../../shared/errors/feed.errors';
import { FeedStore } from '../stores/FeedStore';
import { EntryStore } from '../stores/EntryStore';
import { FeedParserAdapter, type IFeedParserAdapter } from '../parser/FeedParserAdapter';

export interface SyncResult {
  feed: Feed;
  newCount: number;
  entries: EntryListItem[];
}

export class FeedService {
  private feedStore: FeedStore;
  private entryStore: EntryStore;
  private parser: IFeedParserAdapter;

  constructor(
    feedStore: FeedStore,
    entryStore: EntryStore,
    parser?: IFeedParserAdapter,
  ) {
    this.feedStore = feedStore;
    this.entryStore = entryStore;
    this.parser = parser ?? new FeedParserAdapter();
  }

  /**
   * Add a feed by URL: fetch, parse, persist, and sync entries.
   */
  async addFeed(url: string): Promise<{ feed: Feed; entries: EntryListItem[] }> {
    // 1. Validate URL
    if (!this.isValidUrl(url)) {
      throw createFeedError('FEED_INVALID_URL', 'Invalid feed URL format', false);
    }

    // 2. Check duplicate
    const existing = this.feedStore.findByUrl(url);
    if (existing) {
      throw createFeedError(
        'FEED_DUPLICATE',
        'This feed has already been added',
        false,
      );
    }

    // 3. Fetch feed XML/JSON
    let xml: string;
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Shale/1.0 Feed Reader',
          Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml',
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        throw createFeedError(
          'FEED_FETCH_FAILED',
          `HTTP ${response.status}: ${response.statusText}`,
          true,
        );
      }

      xml = await response.text();
    } catch (error) {
      throw createFeedError(
        'FEED_FETCH_FAILED',
        error instanceof Error ? error.message : 'Failed to fetch feed',
        true,
      );
    }

    // 4. Parse
    let parsed;
    try {
      parsed = await this.parser.parse(xml, url);
    } catch (error) {
      throw createFeedError(
        'FEED_PARSE_FAILED',
        error instanceof Error ? error.message : 'Failed to parse feed',
        false,
      );
    }

    // 5. Create feed record
    const feed = this.feedStore.create({
      title: parsed.title,
      feedURL: url,
      siteURL: parsed.siteUrl,
    });

    // 6. Sync entries
    const result = this.syncEntries(feed.id, parsed.entries);

    // 7. Update sync status
    this.feedStore.updateSyncStatus(feed.id, 'success');

    return {
      feed: this.feedStore.findById(feed.id)!,
      entries: result.entries,
    };
  }

  /**
   * Sync a single feed by fetching and parsing its latest content.
   */
  async syncFeed(feedId: number): Promise<SyncResult> {
    const feed = this.feedStore.findById(feedId);
    if (!feed) {
      throw new Error(`Feed not found: ${feedId}`);
    }

    let xml: string;
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'Shale/1.0 Feed Reader',
        Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml',
      };

      // Send conditional request if we have cached ETag/Last-Modified
      if (feed.lastETag) {
        headers['If-None-Match'] = feed.lastETag;
      }
      if (feed.lastModified) {
        headers['If-Modified-Since'] = feed.lastModified;
      }

      const response = await fetch(feed.feedURL, {
        headers,
        signal: AbortSignal.timeout(30_000),
      });

      if (response.status === 304) {
        // Not modified
        this.feedStore.updateSyncStatus(feed.id, 'success');
        const entries = this.entryStore.findByFeed(feedId, { limit: 50 });
        return { feed, newCount: 0, entries: entries.entries };
      }

      // Store conditional headers for next request
      const etag = response.headers.get('etag') ?? undefined;
      const lastModified = response.headers.get('last-modified') ?? undefined;
      this.feedStore.updateSyncHeaders(feed.id, etag, lastModified);

      if (!response.ok) {
        throw createFeedError(
          'FEED_FETCH_FAILED',
          `HTTP ${response.status}: ${response.statusText}`,
          true,
        );
      }

      xml = await response.text();
    } catch (error) {
      this.feedStore.updateSyncStatus(
        feed.id,
        'error',
        error instanceof Error ? error.message : 'Sync failed',
      );
      throw createFeedError(
        'FEED_FETCH_FAILED',
        error instanceof Error ? error.message : 'Failed to fetch feed',
        true,
      );
    }

    // Parse
    let parsed;
    try {
      parsed = await this.parser.parse(xml, feed.feedURL);
    } catch (error) {
      this.feedStore.updateSyncStatus(
        feed.id,
        'error',
        error instanceof Error ? error.message : 'Parse failed',
      );
      throw createFeedError(
        'FEED_PARSE_FAILED',
        error instanceof Error ? error.message : 'Failed to parse feed',
        false,
      );
    }

    // Sync entries
    const result = this.syncEntries(feed.id, parsed.entries);

    // Update feed metadata if changed
    if (parsed.title && parsed.title !== feed.title) {
      this.feedStore.update(feed.id, { title: parsed.title });
    }
    if (parsed.siteUrl && parsed.siteUrl !== feed.siteURL) {
      this.feedStore.update(feed.id, { siteURL: parsed.siteUrl });
    }

    this.feedStore.updateSyncStatus(feed.id, 'success');

    return {
      feed: this.feedStore.findById(feed.id)!,
      newCount: result.newCount,
      entries: result.entries,
    };
  }

  /**
   * Get all feeds.
   */
  async getFeeds(): Promise<Feed[]> {
    return this.feedStore.findAll();
  }

  /**
   * Synchronous version of getFeeds for internal use where async is inconvenient.
   */
  getFeedsSync(): Feed[] {
    return this.feedStore.findAll();
  }

  /**
   * Remove a feed and its cascaded entries/contents.
   */
  /**
   * Update feed properties (title, siteURL, syncIntervalMin).
   * Does not trigger remote re-fetch.
   */
  async updateFeed(
    feedId: number,
    params: { title?: string; siteURL?: string; syncIntervalMin?: number },
  ): Promise<Feed> {
    const feed = this.feedStore.update(feedId, params);
    if (!feed) {
      throw new Error(`Feed not found: ${feedId}`);
    }
    return feed;
  }

  /**
   * Remove a feed and its cascaded entries/contents.
   */
  async removeFeed(feedId: number): Promise<void> {
    this.feedStore.delete(feedId);
  }

  /**
   * Sync all feeds.
   */
  async syncAll(): Promise<Array<{ feedId: number; success: boolean; error?: string }>> {
    const feeds = this.feedStore.findAll();
    const results: Array<{ feedId: number; success: boolean; error?: string }> = [];

    for (const feed of feeds) {
      try {
        await this.syncFeed(feed.id);
        results.push({ feedId: feed.id, success: true });
      } catch (error) {
        results.push({
          feedId: feed.id,
          success: false,
          error: error instanceof Error ? error.message : 'Sync failed',
        });
      }
    }

    return results;
  }

  // ── Private ──────────────────────────────────────────

  private syncEntries(
    feedId: number,
    entries: Array<{ guid: string; url?: string; title?: string; author?: string; publishedAt?: string; summary?: string }>,
  ): { newCount: number; entries: EntryListItem[] } {
    let newCount = 0;

    for (const entry of entries) {
      const result = this.entryStore.createOrUpdate({
        feedId,
        guid: entry.guid || undefined,
        url: entry.url,
        title: entry.title,
        author: entry.author,
        publishedAt: entry.publishedAt,
        summary: entry.summary,
      });

      if (result.isNew) {
        newCount++;
      }
    }

    const result = this.entryStore.findByFeed(feedId, { limit: 50 });
    return { newCount, entries: result.entries };
  }

  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }
}

