import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncScheduler } from '../../../src/main/feed/services/SyncScheduler';
import { SyncCoordinator } from '../../../src/main/feed/services/SyncCoordinator';
import { FeedService } from '../../../src/main/feed/services/FeedService';
import { FeedStore } from '../../../src/main/feed/stores/FeedStore';
import { EntryStore } from '../../../src/main/feed/stores/EntryStore';
import { FeedParserAdapter } from '../../../src/main/feed/parser/FeedParserAdapter';
import { buildTestDb } from '../../fixtures/databases/feed-fixture';
import { createFeedLoggerSpy } from '../../fixtures/feed-logger';

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
    headers: { get: () => null },
    url: 'https://blog.example.com/feed.xml',
  });
}

describe('SyncScheduler', () => {
  let scheduler: SyncScheduler;
  let feedService: FeedService;
  let feedStore: FeedStore;
  let coordinator: SyncCoordinator;

  beforeEach(() => {
    const { db } = buildTestDb();
    feedStore = new FeedStore(db);
    const entryStore = new EntryStore(db);
    const parser = new FeedParserAdapter();
    const feedLogger = createFeedLoggerSpy();
    feedService = new FeedService(feedStore, entryStore, feedLogger.logger, parser);
    coordinator = new SyncCoordinator(feedService, feedLogger.logger, { maxConcurrency: 6 });
    scheduler = new SyncScheduler(feedStore, coordinator, { intervalMin: 30 });
    global.fetch = mockFetch(200, MOCK_FEED_XML);
  });

  afterEach(() => {
    scheduler.stop();
  });

  describe('start/stop', () => {
    it('should start and stop without error', () => {
      expect(scheduler.isRunning).toBe(false);
      scheduler.start();
      expect(scheduler.isRunning).toBe(true);
      scheduler.stop();
      expect(scheduler.isRunning).toBe(false);
    });

    it('should not start twice', () => {
      scheduler.start();
      scheduler.start(); // Should be no-op
      expect(scheduler.isRunning).toBe(true);
      scheduler.stop();
    });

    it('should stop without error if not started', () => {
      scheduler.stop(); // Should be no-op
      expect(scheduler.isRunning).toBe(false);
    });

    it('maps immediate and interval cycles to startup and scheduled triggers', async () => {
      vi.useFakeTimers();
      const syncAll = vi.spyOn(coordinator, 'syncAll').mockResolvedValue([]);

      try {
        scheduler.start();
        await Promise.resolve();
        expect(syncAll).toHaveBeenCalledWith('startup');

        await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
        expect(syncAll).toHaveBeenCalledWith('scheduled');
      } finally {
        scheduler.stop();
        vi.useRealTimers();
      }
    });
  });

  describe('setInterval', () => {
    it('should update the interval', () => {
      scheduler.start();
      scheduler.setInterval(15);
      expect((scheduler as any).intervalMs).toBe(15 * 60 * 1000);
      scheduler.stop();
    });
  });

  describe('triggerNow', () => {
    it('should trigger a sync cycle immediately', async () => {
      global.fetch = mockFetch(200, MOCK_FEED_XML);
      await feedService.addFeed('https://example.com/feed.xml');
      vi.clearAllMocks();
      global.fetch = mockFetch(200, MOCK_FEED_XML);

      scheduler.start();
      const results = await scheduler.triggerNow();
      expect(Array.isArray(results)).toBe(true);
      scheduler.stop();
    });

    it('maps an explicit scheduler trigger to the internal manual trigger', async () => {
      const syncAll = vi.spyOn(coordinator, 'syncAll').mockResolvedValue([]);
      scheduler.start();
      await Promise.resolve();

      await scheduler.triggerNow();

      expect(syncAll).toHaveBeenLastCalledWith('manual');
    });
  });

  describe('isCycleInProgress', () => {
    it('should report true during active cycle and false after', async () => {
      // start() triggers an immediate cycle, so isCycleInProgress is set synchronously
      scheduler.start();
      // The synchronous part of runCycle sets cycleInProgress = true
      expect(scheduler.isCycleInProgress).toBe(true);
      // Wait for the cycle to complete
      await new Promise((r) => setTimeout(r, 100));
      expect(scheduler.isCycleInProgress).toBe(false);
      scheduler.stop();
    });
  });
});
