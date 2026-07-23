import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FeedService } from '../../src/main/feed/services/FeedService';
import { FeedStore } from '../../src/main/feed/stores/FeedStore';
import { EntryStore } from '../../src/main/feed/stores/EntryStore';
import { FeedParserAdapter } from '../../src/main/feed/parser/FeedParserAdapter';
import { buildTestDb } from '../fixtures/databases/feed-fixture';
import type { IFeedParserAdapter } from '../../src/main/feed/parser/FeedParserAdapter';
import { createFeedLoggerSpy, type FeedLogRecord } from '../fixtures/feed-logger';

// ── Helpers ──────────────────────────────────────────

const MOCK_FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Test Blog</title>
  <link>https://blog.example.com</link>
  <item>
    <guid>post-1</guid>
    <title>First Post</title>
    <link>https://blog.example.com/1</link>
    <pubDate>Mon, 14 Jul 2026 10:00:00 GMT</pubDate>
  </item>
  <item>
    <guid>post-2</guid>
    <title>Second Post</title>
    <link>https://blog.example.com/2</link>
    <pubDate>Sun, 13 Jul 2026 10:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

function mockFetch(status: number, body: string, headers?: Record<string, string>) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: () => Promise.resolve(body),
    headers: {
      get: (name: string) => (headers ?? {})[name.toLowerCase()] ?? null,
    },
    url: 'https://blog.example.com/feed.xml',
  });
}

describe('FeedService', () => {
  let service: FeedService;
  let feedStore: FeedStore;
  let entryStore: EntryStore;
  let parser: IFeedParserAdapter;
  let logRecords: FeedLogRecord[];

  beforeEach(() => {
    const { db } = buildTestDb();
    feedStore = new FeedStore(db);
    entryStore = new EntryStore(db);
    parser = new FeedParserAdapter();
    const feedLogger = createFeedLoggerSpy();
    logRecords = feedLogger.records;
    service = new FeedService(feedStore, entryStore, feedLogger.logger, parser);
  });

  describe('addFeed', () => {
    it('should reject invalid URLs', async () => {
      await expect(service.addFeed('not-a-url')).rejects.toMatchObject({
        code: 'FEED_INVALID_URL',
      });

      await expect(service.addFeed('ftp://example.com/feed')).rejects.toMatchObject({
        code: 'FEED_INVALID_URL',
      });
    });

    it('should reject duplicate feeds', async () => {
      global.fetch = mockFetch(200, MOCK_FEED_XML);
      await service.addFeed('https://example.com/feed.xml');

      await expect(
        service.addFeed('https://example.com/feed.xml'),
      ).rejects.toMatchObject({ code: 'FEED_DUPLICATE' });
    });

    it('should reject duplicate feeds (case-insensitive host)', async () => {
      global.fetch = mockFetch(200, MOCK_FEED_XML);
      await service.addFeed('https://example.com/feed.xml');

      await expect(
        service.addFeed('HTTPS://EXAMPLE.COM/feed.xml'),
      ).rejects.toMatchObject({ code: 'FEED_DUPLICATE' });
    });

    it('should reject duplicate feeds (trailing slash difference)', async () => {
      global.fetch = mockFetch(200, MOCK_FEED_XML);
      await service.addFeed('https://example.com/feed.xml');

      await expect(
        service.addFeed('https://example.com/feed.xml/'),
      ).rejects.toMatchObject({ code: 'FEED_DUPLICATE' });
    });

    it('should allow feeds with different protocols', async () => {
      global.fetch = mockFetch(200, MOCK_FEED_XML);
      await service.addFeed('https://example.com/feed.xml');

      global.fetch = mockFetch(200, MOCK_FEED_XML);
      // http and https are treated as different feeds
      await expect(
        service.addFeed('http://example.com/feed.xml'),
      ).resolves.toBeDefined();

      const feeds = await service.getFeeds();
      expect(feeds).toHaveLength(2);
    });

    it('should reject duplicate feeds (default port difference)', async () => {
      global.fetch = mockFetch(200, MOCK_FEED_XML);
      await service.addFeed('https://example.com/feed.xml');

      await expect(
        service.addFeed('https://example.com:443/feed.xml'),
      ).rejects.toMatchObject({ code: 'FEED_DUPLICATE' });
    });

    it('should successfully add a feed and return entries', async () => {
      global.fetch = mockFetch(200, MOCK_FEED_XML);

      const result = await service.addFeed('https://example.com/feed.xml');

      expect(result.feed.title).toBe('Test Blog');
      expect(result.feed.feedURL).toBe('https://example.com/feed.xml');
      expect(result.feed.lastSyncStatus).toBe('success');
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].title).toBe('First Post');
      expect(logRecords).toEqual([
        expect.objectContaining({
          level: 'info',
          event: 'feed.add.completed',
          component: 'feed.service',
          context: expect.objectContaining({
            feedId: result.feed.id,
            success: true,
          }),
        }),
      ]);
    });

    it('should reject feed fetch failure', async () => {
      const canary = 'CANARY_NETWORK_ERROR_MUST_NOT_BE_LOGGED';
      global.fetch = vi.fn().mockRejectedValue(new Error(canary));

      await expect(
        service.addFeed('https://unreachable.example.com/feed'),
      ).rejects.toMatchObject({ code: 'FEED_FETCH_FAILED' });

      expect(logRecords).toEqual([
        expect.objectContaining({
          level: 'error',
          event: 'feed.add.failed',
          component: 'feed.service',
          context: expect.objectContaining({
            success: false,
            errorCode: 'FEED_ADD_FAILED',
          }),
        }),
      ]);
      expect(JSON.stringify(logRecords)).not.toContain(canary);
      expect(JSON.stringify(logRecords)).not.toContain('unreachable.example.com');
    });

    it('should reject HTTP error status', async () => {
      global.fetch = mockFetch(404, 'Not Found');

      await expect(
        service.addFeed('https://example.com/404'),
      ).rejects.toMatchObject({ code: 'FEED_FETCH_FAILED' });
    });
  });

  describe('syncFeed', () => {
    beforeEach(async () => {
      global.fetch = mockFetch(200, MOCK_FEED_XML);
      await service.addFeed('https://example.com/feed.xml');
      vi.clearAllMocks();
    });

    it('should sync and detect new entries', async () => {
      // Simulate a feed with one new entry
      const updatedXml = MOCK_FEED_XML.replace(
        '</channel>',
        '<item><guid>post-3</guid><title>Third Post</title><link>https://blog.example.com/3</link></item></channel>',
      );
      global.fetch = mockFetch(200, updatedXml);

      const result = await service.syncFeed(1);

      expect(result.newCount).toBe(1);
      expect(result.feed.lastSyncStatus).toBe('success');
      expect(result.feed.lastFetchedAt).toBeDefined();
    });

    it('should update feed metadata when changed', async () => {
      const updatedXml = MOCK_FEED_XML.replace(
        '<title>Test Blog</title>',
        '<title>Renamed Blog</title>',
      );
      global.fetch = mockFetch(200, updatedXml);

      const result = await service.syncFeed(1);
      expect(result.feed.title).toBe('Renamed Blog');
    });

    it('should handle 304 not modified', async () => {
      global.fetch = mockFetch(304, '');

      const result = await service.syncFeed(1);

      expect(result.newCount).toBe(0);
      expect(result.feed.lastSyncStatus).toBe('success');
    });

    it('should store ETag and Last-Modified', async () => {
      global.fetch = mockFetch(200, MOCK_FEED_XML, {
        etag: '"abc123"',
        'last-modified': 'Mon, 14 Jul 2026 10:00:00 GMT',
      });

      await service.syncFeed(1);
      const feed = feedStore.findById(1);
      expect(feed!.lastETag).toBe('"abc123"');
      expect(feed!.lastModified).toBe('Mon, 14 Jul 2026 10:00:00 GMT');
    });
  });

  describe('getFeeds', () => {
    it('should return all feeds', async () => {
      global.fetch = mockFetch(200, MOCK_FEED_XML);
      await service.addFeed('https://a.example.com/feed.xml');

      const feedB = MOCK_FEED_XML.replace('Test Blog', 'Blog B');
      global.fetch = mockFetch(200, feedB);
      await service.addFeed('https://b.example.com/feed.xml');

      const feeds = await service.getFeeds();
      expect(feeds).toHaveLength(2);
    });
  });

  describe('removeFeed', () => {
    it('should remove feed and cascade entries', async () => {
      global.fetch = mockFetch(200, MOCK_FEED_XML);
      await service.addFeed('https://example.com/feed.xml');

      await service.removeFeed(1);
      expect(feedStore.findById(1)).toBeUndefined();
    });
  });

  describe('syncAll', () => {
    it('should sync all feeds with per-feed results', async () => {
      global.fetch = mockFetch(200, MOCK_FEED_XML);
      await service.addFeed('https://a.example.com/feed.xml');

      const feedB = MOCK_FEED_XML.replace('Test Blog', 'Blog B');
      global.fetch = mockFetch(200, feedB);
      await service.addFeed('https://b.example.com/feed.xml');

      vi.clearAllMocks();
      global.fetch = mockFetch(200, MOCK_FEED_XML);

      const results = await service.syncAll();
      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });
  });
});
