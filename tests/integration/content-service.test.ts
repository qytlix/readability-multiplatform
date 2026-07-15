import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContentService } from '../../src/main/feed/ContentService';
import { ContentStore } from '../../src/main/feed/ContentStore';
import { EntryStore } from '../../src/main/feed/EntryStore';
import { FeedStore } from '../../src/main/feed/FeedStore';
import { ContentFetcher } from '../../src/main/feed/ContentFetcher';
import { ContentCleaner } from '../../src/main/feed/ContentCleaner';
import { MarkdownConverter } from '../../src/main/feed/MarkdownConverter';
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
});
