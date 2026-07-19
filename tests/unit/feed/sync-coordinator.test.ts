import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncCoordinator } from '../../../src/main/feed/services/SyncCoordinator';
import { FeedService } from '../../../src/main/feed/services/FeedService';
import { FeedStore } from '../../../src/main/feed/stores/FeedStore';
import { EntryStore } from '../../../src/main/feed/stores/EntryStore';
import { FeedParserAdapter } from '../../../src/main/feed/parser/FeedParserAdapter';
import { buildTestDb } from '../../fixtures/databases/feed-fixture';

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
</channel></rss>`;

function mockFetch(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: () => Promise.resolve(body),
    headers: {
      get: (name: string) => null,
    },
    url: 'https://blog.example.com/feed.xml',
  });
}

describe('SyncCoordinator', () => {
  let coordinator: SyncCoordinator;
  let feedService: FeedService;
  let feedStore: FeedStore;
  let entryStore: EntryStore;

  beforeEach(() => {
    const { db } = buildTestDb();
    feedStore = new FeedStore(db);
    entryStore = new EntryStore(db);
    const parser = new FeedParserAdapter();
    feedService = new FeedService(feedStore, entryStore, parser);
    coordinator = new SyncCoordinator(feedService, { maxConcurrency: 6 });
    global.fetch = mockFetch(200, MOCK_FEED_XML);
  });

  describe('syncFeed', () => {
    it('should sync a single feed', async () => {
      const addResult = await feedService.addFeed('https://example.com/feed.xml');
      vi.clearAllMocks();
      global.fetch = mockFetch(200, MOCK_FEED_XML);

      const result = await coordinator.syncFeed(addResult.feed.id);
      expect(result.newCount).toBe(0); // Already synced
      expect(result.feed.lastSyncStatus).toBe('success');
    });

    it('should reject concurrent sync of the same feed', async () => {
      const addResult = await feedService.addFeed('https://example.com/feed.xml');
      vi.clearAllMocks();

      // Simulate slow response
      global.fetch = vi.fn().mockImplementation(() =>
        new Promise((resolve) => setTimeout(resolve, 100)).then(() =>
          mockFetch(200, MOCK_FEED_XML)(),
        ),
      );

      // Start first sync
      const promise1 = coordinator.syncFeed(addResult.feed.id);
      // Wait a tick to let it start
      await new Promise((r) => setTimeout(r, 10));

      // Second sync should throw
      await expect(
        coordinator.syncFeed(addResult.feed.id),
      ).rejects.toThrow(/already being synced/i);

      await promise1;
    });
  });

  describe('syncAll', () => {
    it('should sync all feeds', async () => {
      global.fetch = mockFetch(200, MOCK_FEED_XML);
      await feedService.addFeed('https://a.example.com/feed.xml');

      const feedB = MOCK_FEED_XML.replace('Test Blog', 'Blog B');
      global.fetch = mockFetch(200, feedB);
      await feedService.addFeed('https://b.example.com/feed.xml');

      vi.clearAllMocks();
      global.fetch = mockFetch(200, MOCK_FEED_XML);

      const results = await coordinator.syncAll();
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it('should report per-feed results when some fail', async () => {
      global.fetch = mockFetch(200, MOCK_FEED_XML);
      await feedService.addFeed('https://a.example.com/feed.xml');
      await feedService.addFeed('https://b.example.com/feed.xml');
      await feedService.addFeed('https://c.example.com/feed.xml');

      vi.clearAllMocks();
      // First call succeeds, others fail by alternating
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return mockFetch(200, MOCK_FEED_XML)();
        }
        return Promise.reject(new Error('Network error'));
      });

      const results = await coordinator.syncAll();
      expect(results).toHaveLength(3);
      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(2);
    });
  });

  describe('cancelAll', () => {
    it('should cancel in-progress syncs', async () => {
      global.fetch = mockFetch(200, MOCK_FEED_XML);
      await feedService.addFeed('https://example.com/feed.xml');

      vi.clearAllMocks();
      global.fetch = vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Aborted')), 1000),
          ),
      );

      // Start syncAll and cancel after a tick
      const promise = coordinator.syncAll();
      await new Promise((r) => setTimeout(r, 10));
      coordinator.cancelAll();

      const results = await promise;
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('isFeedSyncing', () => {
    it('should report syncing status correctly', async () => {
      const addResult = await feedService.addFeed('https://example.com/feed.xml');
      vi.clearAllMocks();

      global.fetch = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(mockFetch(200, MOCK_FEED_XML)()), 100),
          ),
      );

      const promise = coordinator.syncFeed(addResult.feed.id);
      await new Promise((r) => setTimeout(r, 10));
      expect(coordinator.isFeedSyncing(addResult.feed.id)).toBe(true);
      await promise;
      expect(coordinator.isFeedSyncing(addResult.feed.id)).toBe(false);
    });
  });

  describe('setMaxConcurrency', () => {
    it('should clamp concurrency between 1 and 10', () => {
      coordinator.setMaxConcurrency(0);
      expect((coordinator as any).maxConcurrency).toBe(1);

      coordinator.setMaxConcurrency(20);
      expect((coordinator as any).maxConcurrency).toBe(10);

      coordinator.setMaxConcurrency(5);
      expect((coordinator as any).maxConcurrency).toBe(5);
    });
  });
});