import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FetcherStrategy } from '../../src/main/feed/fetcher/FetchStrategy';
import { ContentFetcher } from '../../src/main/feed/fetcher/ContentFetcher';
import { ContentService } from '../../src/main/feed/services/ContentService';
import { ContentStore } from '../../src/main/feed/stores/ContentStore';
import { EntryStore } from '../../src/main/feed/stores/EntryStore';
import { FeedStore } from '../../src/main/feed/stores/FeedStore';
import { CONTENT_CLEANER_VERSION } from '../../src/main/feed/fetcher/ContentCleaner';
import { MARKDOWN_CONVERTER_VERSION } from '../../src/main/feed/fetcher/MarkdownConverter';
import { buildTestDb } from '../fixtures/databases/feed-fixture';

const SAMPLE_HTML =
  '<html><body><article><h1>Test Article</h1><p>Hello <strong>world</strong>!</p></article></body></html>';

function mockFetcher(html: string = SAMPLE_HTML) {
  return {
    fetch: vi.fn().mockResolvedValue({
      url: 'https://example.com/article',
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: html,
    }),
  };
}

describe('ContentService', () => {
  let contentService: ContentService;
  let contentStore: ContentStore;
  let entryStore: EntryStore;
  let feedStore: FeedStore;
  let db: ReturnType<typeof buildTestDb>['db'];
  let entryId: number;

  beforeEach(() => {
    const testDb = buildTestDb();
    db = testDb.db;
    contentStore = new ContentStore(db);
    entryStore = new EntryStore(db);
    feedStore = new FeedStore(db);

    const feed = feedStore.create({
      title: 'Test Feed',
      feedURL: 'https://example.com/feed.xml',
    });

    const { id } = entryStore.createOrUpdate({
      feedId: feed.id,
      guid: 'guid-1',
      url: 'https://example.com/post-1',
      title: 'Test Post',
    });
    entryId = id;

    const fetcher = mockFetcher();
    contentService = new ContentService(
      contentStore,
      entryStore,
      fetcher as unknown as ContentFetcher,
    );
  });

  describe('getContent', () => {
    it('should return undefined for no existing content', async () => {
      const result = await contentService.getContent(entryId);
      expect(result).toBeUndefined();
    });

    it('should return existing content after fetchAndClean', async () => {
      await contentService.fetchAndClean(entryId);
      const result = await contentService.getContent(entryId);
      expect(result).toBeDefined();
      expect(result!.entryId).toBe(entryId);
      expect(result!.pipelineStatus).toBe('success');
    });

    it('repairs a failed refresh when sanitized cached content still exists', async () => {
      contentStore.upsert({
        entryId,
        cleanedHtml: '<p>Previously extracted article body.</p>',
        markdown: 'Previously extracted article body.',
        readabilityVersion: CONTENT_CLEANER_VERSION,
        markdownVersion: MARKDOWN_CONVERTER_VERSION,
        pipelineStatus: 'failed',
        pipelineError: 'Readability could not extract content',
      });

      const result = await contentService.getContent(entryId);

      expect(result).toMatchObject({
        pipelineStatus: 'success',
        pipelineError: undefined,
      });
      expect(result?.cleanedHtml).toContain('Previously extracted');
      expect(
        db.prepare(
          'SELECT pipelineStatus, pipelineError FROM entry_content WHERE entryId = ?',
        ).get(entryId),
      ).toEqual({ pipelineStatus: 'success', pipelineError: null });
    });

    it('rebuilds stale cleaned content locally without refetching the article', async () => {
      contentStore.upsert({
        entryId,
        cleanedHtml: [
          '<p>📌 Pinned</p>',
          '<img src="https://example.com/article.jpg" alt="Article photo">',
          '<img width="24" height="24" src="https://example.com/pin.svg" alt="Pushpin">',
        ].join(''),
        markdown: '📌 Pinned\n\n![Pushpin](https://example.com/pin.svg)',
        markdownVersion: 1,
        pipelineStatus: 'success',
      });

      const result = await contentService.getContent(entryId);

      expect(result?.markdown).toContain('Pinned');
      expect(result?.markdown).toContain(
        '![Article photo](https://example.com/article.jpg)',
      );
      expect(result?.markdown).not.toContain('📌');
      expect(result?.markdown).not.toContain('pin.svg');
      expect(result?.cleanedHtml).not.toContain('📌');
      expect(result?.cleanedHtml).not.toContain('pin.svg');
      expect(result?.cleanedHtml).toContain('article.jpg');
      expect(
        db.prepare(`
          SELECT readabilityVersion, markdownVersion
          FROM entry_content
          WHERE entryId = ?
        `)
          .get(entryId),
      ).toEqual({
        readabilityVersion: CONTENT_CLEANER_VERSION,
        markdownVersion: MARKDOWN_CONVERTER_VERSION,
      });
    });

    it('re-extracts stored raw HTML when the cleaner version is stale', async () => {
      const hiddenPayload = JSON.stringify({
        ENV: 'production',
        ARC_ACCESS_TOKEN_PROD: 'encoded-token-'.repeat(80),
      });
      const rawHtml = `<html>
        <head><title>Stored live article</title></head>
        <body>
          <div id="fusion-app">
            <article>
              <p>The stored article body remains available offline.</p>
              <p>Its second paragraph contains the rest of the report.</p>
            </article>
          </div>
          <div id="stream-context" class="hidden">${hiddenPayload}</div>
        </body>
      </html>`;
      contentStore.upsert({
        entryId,
        html: rawHtml,
        sourceUrl: 'https://example.com/live/article',
        cleanedHtml: [
          '<p>The stored article body remains available offline.</p>',
          `<p>${hiddenPayload}</p>`,
        ].join(''),
        markdown: `The stored article body remains available offline.\n\n${hiddenPayload}`,
        readabilityVersion: 0,
        markdownVersion: 0,
        pipelineStatus: 'success',
      });
      const fetcher = mockFetcher('<p>Network content must not be used.</p>');
      const service = new ContentService(
        contentStore,
        entryStore,
        fetcher as unknown as ContentFetcher,
      );

      const result = await service.getContent(entryId);

      expect(fetcher.fetch).not.toHaveBeenCalled();
      expect(result?.cleanedHtml).toContain('stored article body');
      expect(result?.cleanedHtml).not.toContain('ARC_ACCESS_TOKEN_PROD');
      expect(result?.markdown).not.toContain('encoded-token');
      expect(
        db.prepare(`
          SELECT readabilityVersion
          FROM entry_content
          WHERE entryId = ?
        `)
          .get(entryId),
      ).toEqual({ readabilityVersion: CONTENT_CLEANER_VERSION });
    });
  });

  describe('fetchAndClean', () => {
    it('should fetch, clean, and convert an article', async () => {
      const result = await contentService.fetchAndClean(entryId);

      expect(result.entryId).toBe(entryId);
      expect(result.pipelineStatus).toBe('success');
      expect(result.sourceUrl).toBe('https://example.com/article');
      expect(result.cleanedHtml).toBeTruthy();
      expect(result.markdown).toBeTruthy();
      expect(result.readabilityTitle).toBeDefined();
      expect(result.sourceContentHash).toBeDefined();
      expect(result.sourceContentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.segments?.map((segment) => segment.type)).toEqual([
        'title',
        'heading',
        'paragraph',
      ]);
    });

    it('should persist content to store', async () => {
      await contentService.fetchAndClean(entryId);

      const stored = contentStore.findByEntry(entryId);
      expect(stored).toBeDefined();
      expect(stored!.cleanedHtml).toBeTruthy();
      expect(stored!.markdown).toBeTruthy();
    });

    it('should handle entry not found', async () => {
      const result = await contentService.fetchAndClean(999);
      expect(result.pipelineStatus).toBe('failed');
      expect(result.pipelineError).toBe('Entry not found');
    });

    it('should handle entry without URL', async () => {
      const feed = feedStore.create({
        title: 'No URL Feed',
        feedURL: 'https://example.com/feed2.xml',
      });
      const { id } = entryStore.createOrUpdate({
        feedId: feed.id,
        guid: 'guid-no-url',
        title: 'No URL Entry',
      });

      const result = await contentService.fetchAndClean(id);
      expect(result.pipelineStatus).toBe('failed');
      expect(result.pipelineError).toBe('Entry has no URL');
    });

    it('should handle fetch failure', async () => {
      const fetcher = {
        fetch: vi.fn().mockRejectedValue(new Error('Network error')),
      };
      const svc = new ContentService(
        contentStore,
        entryStore,
        fetcher as unknown as ContentFetcher,
      );

      const result = await svc.fetchAndClean(entryId);
      expect(result.pipelineStatus).toBe('failed');
      expect(result.pipelineError).toBe('Network error');
    });

    it('keeps the last known good article when a refresh fails', async () => {
      const first = await contentService.fetchAndClean(entryId);
      const fetcher = {
        fetch: vi.fn().mockRejectedValue(new Error('Network error')),
      };
      const svc = new ContentService(
        contentStore,
        entryStore,
        fetcher as unknown as ContentFetcher,
      );

      const result = await svc.fetchAndClean(entryId);

      expect(result.pipelineStatus).toBe('success');
      expect(result.cleanedHtml).toBe(first.cleanedHtml);
      expect(contentStore.findByEntry(entryId)).toMatchObject({
        pipelineStatus: 'success',
        pipelineError: undefined,
      });
    });

    it('falls back to sanitized feed entry HTML when the linked page fails', async () => {
      entryStore.createOrUpdate({
        feedId: 1,
        guid: 'guid-1',
        feedContentHtml: `
          <p>Publisher-provided fallback body.</p>
          <script>window.evil = true</script>
        `,
      });
      const fetcher = {
        fetch: vi.fn().mockRejectedValue(new Error('HTTP 403: Forbidden')),
      };
      const svc = new ContentService(
        contentStore,
        entryStore,
        fetcher as unknown as ContentFetcher,
      );

      const result = await svc.fetchAndClean(entryId);

      expect(result.pipelineStatus).toBe('success');
      expect(result.cleanedHtml).toContain('Publisher-provided fallback body.');
      expect(result.cleanedHtml).not.toContain('<script');
      expect(contentStore.findByEntry(entryId)?.pipelineStatus).toBe('success');
    });

    it('should update pipeline status across phases', async () => {
      // Use a real ContentService and mock fetcher to fail
      const fetcher = {
        fetch: vi.fn().mockRejectedValue(new Error('Timeout')),
      };
      const svc = new ContentService(
        contentStore,
        entryStore,
        fetcher as unknown as ContentFetcher,
      );

      await svc.fetchAndClean(entryId);

      const stored = contentStore.findByEntry(entryId);
      expect(stored!.pipelineStatus).toBe('failed');
      expect(stored!.pipelineError).toBe('Timeout');
    });

    it('should overwrite existing content on re-fetch', async () => {
      // First fetch
      await contentService.fetchAndClean(entryId);
      const first = contentStore.findByEntry(entryId);
      const firstHash = first!.sourceContentHash;

      // Re-fetch with different content (use a full HTML document with <title> tag)
      const fetcher2 = mockFetcher(
        '<html><head><title>Updated Article</title></head><body><article><p>Updated content</p></article></body></html>',
      );
      const svc2 = new ContentService(
        contentStore,
        entryStore,
        fetcher2 as unknown as ContentFetcher,
      );
      await svc2.fetchAndClean(entryId);

      const second = contentStore.findByEntry(entryId);
      expect(second!.sourceContentHash).not.toBe(firstHash);
      expect(second!.readabilityTitle).toBe('Updated Article');
    });
  });

  describe('fetchAndClean with strategy fallback', () => {
    it('should succeed when T0 fails and T1 succeeds', async () => {
      // Create mock strategies: T0 always fails, T1 returns valid HTML
      const successResult = {
        url: 'https://example.com/article',
        statusCode: 200,
        headers: { 'content-type': 'text/html' } as Record<string, string>,
        body: SAMPLE_HTML,
      };

      const t0: FetcherStrategy = {
        name: 'mock-t0',
        isAvailable: () => true,
        fetch: vi.fn().mockRejectedValue(new Error('Tier 0 failed')),
      };
      const t1: FetcherStrategy = {
        name: 'mock-t1',
        isAvailable: () => true,
        fetch: vi.fn().mockResolvedValue(successResult),
      };

      const fetcher = new ContentFetcher({ strategies: [t0, t1] });
      const svc = new ContentService(contentStore, entryStore, fetcher);

      const result = await svc.fetchAndClean(entryId);

      expect(result.pipelineStatus).toBe('success');
      expect(result.cleanedHtml).toBeTruthy();
      expect(result.markdown).toBeTruthy();
      expect((t0.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
      expect((t1.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    });

    it('should fail when all strategies fail', async () => {
      const t0: FetcherStrategy = {
        name: 'mock-t0',
        isAvailable: () => true,
        fetch: vi.fn().mockRejectedValue(new Error('Tier 0 error')),
      };
      const t1: FetcherStrategy = {
        name: 'mock-t1',
        isAvailable: () => true,
        fetch: vi.fn().mockRejectedValue(new Error('Tier 1 error')),
      };

      const fetcher = new ContentFetcher({ strategies: [t0, t1] });
      const svc = new ContentService(contentStore, entryStore, fetcher);

      const result = await svc.fetchAndClean(entryId);

      expect(result.pipelineStatus).toBe('failed');
      expect(result.pipelineError).toBe('Tier 1 error');
      expect((t0.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
      expect((t1.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    });
  });
});
