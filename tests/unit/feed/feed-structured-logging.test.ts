import { describe, expect, it, vi } from 'vitest';
import { FeedService } from '../../../src/main/feed/services/FeedService';
import { SyncCoordinator } from '../../../src/main/feed/services/SyncCoordinator';
import { SyncScheduler } from '../../../src/main/feed/services/SyncScheduler';
import type { FeedService as FeedServiceType, SyncResult } from '../../../src/main/feed/services/FeedService';
import type { FeedStore } from '../../../src/main/feed/stores/FeedStore';
import type { EntryStore } from '../../../src/main/feed/stores/EntryStore';
import type { IFeedParserAdapter } from '../../../src/main/feed/parser/FeedParserAdapter';
import type { Feed, ParsedFeed } from '../../../src/shared/contracts/feed.types';
import { createFeedLoggerSpy } from '../../fixtures/feed-logger';

const TEST_FEED: Feed = {
  id: 42,
  title: 'Sensitive feed title',
  feedURL: 'https://sensitive.example.com/feed.xml',
  lastSyncStatus: 'success',
  syncIntervalMin: 30,
  createdAt: '2026-07-20T00:00:00.000Z',
};

function createFeedServiceForAddTests() {
  const feedLogger = createFeedLoggerSpy();
  const feedStore = {
    findByUrl: vi.fn(() => undefined),
    findByDedupKey: vi.fn(() => undefined),
    create: vi.fn(() => TEST_FEED),
    findById: vi.fn(() => TEST_FEED),
    updateSyncStatus: vi.fn(),
  } as unknown as FeedStore;
  const entryStore = {
    createOrUpdate: vi.fn(() => ({ id: 1, isNew: true })),
    findByFeed: vi.fn(() => ({ entries: [] })),
  } as unknown as EntryStore;
  const parsedFeed: ParsedFeed = {
    title: TEST_FEED.title,
    feedUrl: TEST_FEED.feedURL,
    entries: [],
  };
  const parser: IFeedParserAdapter = {
    parse: vi.fn().mockResolvedValue(parsedFeed),
  };
  const service = new FeedService(feedStore, entryStore, feedLogger.logger, parser);

  return { feedLogger, service };
}

function createCoordinatorForSyncTests(syncFeed: (feedId: number) => Promise<SyncResult>) {
  const feedLogger = createFeedLoggerSpy();
  const service = {
    getFeedsSync: () => [TEST_FEED],
    syncFeed,
  } as unknown as FeedServiceType;
  const coordinator = new SyncCoordinator(service, feedLogger.logger);

  return { coordinator, feedLogger };
}

describe('Feed structured logging', () => {
  it('records only safe completion fields for a successful Feed add', async () => {
    const { feedLogger, service } = createFeedServiceForAddTests();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<rss>private content</rss>'),
    });

    const result = await service.addFeed(TEST_FEED.feedURL);

    expect(result.feed).toBe(TEST_FEED);
    expect(feedLogger.records).toEqual([
      expect.objectContaining({
        level: 'info',
        event: 'feed.add.completed',
        component: 'feed.service',
        context: expect.objectContaining({
          feedId: 42,
          success: true,
        }),
      }),
    ]);
    expect(JSON.stringify(feedLogger.records)).not.toContain('sensitive.example.com');
    expect(JSON.stringify(feedLogger.records)).not.toContain('Sensitive feed title');
  });

  it('preserves Feed add failures while excluding URLs and original error messages', async () => {
    const { feedLogger, service } = createFeedServiceForAddTests();
    const canary = 'CANARY_ADD_FAILURE_MESSAGE_MUST_NOT_BE_LOGGED';
    global.fetch = vi.fn().mockRejectedValue(new Error(canary));

    await expect(service.addFeed(TEST_FEED.feedURL)).rejects.toMatchObject({
      code: 'FEED_FETCH_FAILED',
      message: canary,
    });

    expect(feedLogger.records).toEqual([
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
    expect(JSON.stringify(feedLogger.records)).not.toContain(canary);
    expect(JSON.stringify(feedLogger.records)).not.toContain('sensitive.example.com');
  });

  it('preserves a successful all-feed result while using one run summary', async () => {
    const syncResult: SyncResult = { feed: TEST_FEED, newCount: 3, entries: [] };
    const { coordinator, feedLogger } = createCoordinatorForSyncTests(
      vi.fn().mockResolvedValue(syncResult),
    );

    const results = await coordinator.syncAll('scheduled');

    expect(results).toEqual([{ feedId: 42, success: true, newCount: 3 }]);
    expect(feedLogger.records).toEqual([
      expect.objectContaining({
        event: 'feed.sync.run.started',
        component: 'feed.sync',
        context: { trigger: 'scheduled' },
      }),
      expect.objectContaining({
        event: 'feed.sync.run.completed',
        component: 'feed.sync',
        context: expect.objectContaining({
          trigger: 'scheduled',
          successCount: 1,
          failureCount: 0,
          newCount: 3,
        }),
      }),
    ]);
    expect(feedLogger.records.some((record) => record.event === 'feed.sync.feed.completed')).toBe(false);
  });

  it('logs a safe per-feed failure while preserving the existing all-feed result', async () => {
    const canary = 'CANARY_SYNC_FAILURE_MESSAGE_MUST_NOT_BE_LOGGED';
    const { coordinator, feedLogger } = createCoordinatorForSyncTests(
      vi.fn().mockRejectedValue(new Error(canary)),
    );

    const results = await coordinator.syncAll('startup');

    expect(results).toEqual([
      { feedId: 42, success: false, error: canary, newCount: 0 },
    ]);
    expect(feedLogger.records).toContainEqual(expect.objectContaining({
      level: 'error',
      event: 'feed.sync.feed.failed',
      component: 'feed.sync',
      context: expect.objectContaining({
        feedId: 42,
        trigger: 'startup',
        errorCode: 'FEED_SYNC_FAILED',
      }),
    }));
    expect(feedLogger.records).toContainEqual(expect.objectContaining({
      event: 'feed.sync.run.completed',
      context: expect.objectContaining({
        trigger: 'startup',
        successCount: 0,
        failureCount: 1,
        newCount: 0,
      }),
    }));
    expect(JSON.stringify(feedLogger.records)).not.toContain(canary);
    expect(JSON.stringify(feedLogger.records)).not.toContain('sensitive.example.com');
  });

  it('preserves a single-feed rejection and records the corresponding safe summary', async () => {
    const originalError = new Error('CANARY_SINGLE_SYNC_FAILURE_MESSAGE_MUST_NOT_BE_LOGGED');
    const { coordinator, feedLogger } = createCoordinatorForSyncTests(
      vi.fn().mockRejectedValue(originalError),
    );

    await expect(coordinator.syncFeed(42, 'manual')).rejects.toBe(originalError);

    expect(feedLogger.records).toEqual([
      expect.objectContaining({
        event: 'feed.sync.run.started',
        context: { feedId: 42, trigger: 'manual' },
      }),
      expect.objectContaining({
        event: 'feed.sync.feed.failed',
        context: expect.objectContaining({
          feedId: 42,
          trigger: 'manual',
          errorCode: 'FEED_SYNC_FAILED',
        }),
      }),
      expect.objectContaining({
        event: 'feed.sync.run.completed',
        context: expect.objectContaining({
          feedId: 42,
          trigger: 'manual',
          successCount: 0,
          failureCount: 1,
          newCount: 0,
        }),
      }),
    ]);
    expect(JSON.stringify(feedLogger.records)).not.toContain(originalError.message);
  });

  it('records a fixed run failure only when the coordinator cannot produce a summary', async () => {
    const originalError = new Error('CANARY_COORDINATOR_FAILURE_MESSAGE_MUST_NOT_BE_LOGGED');
    const feedLogger = createFeedLoggerSpy();
    const service = {
      getFeedsSync: () => {
        throw originalError;
      },
    } as unknown as FeedServiceType;
    const coordinator = new SyncCoordinator(service, feedLogger.logger);

    await expect(coordinator.syncAll('manual')).rejects.toBe(originalError);

    expect(feedLogger.records).toEqual([
      expect.objectContaining({
        event: 'feed.sync.run.started',
        context: { trigger: 'manual' },
      }),
      {
        level: 'error',
        event: 'feed.sync.run.failed',
        component: 'feed.sync',
        context: { errorCode: 'FEED_SYNC_RUN_FAILED' },
      },
    ]);
    expect(JSON.stringify(feedLogger.records)).not.toContain(originalError.message);
  });

  it('does not let a logger failure change a successful Feed add', async () => {
    const feedStore = {
      findByUrl: vi.fn(() => undefined),
      findByDedupKey: vi.fn(() => undefined),
      create: vi.fn(() => TEST_FEED),
      findById: vi.fn(() => TEST_FEED),
      updateSyncStatus: vi.fn(),
    } as unknown as FeedStore;
    const entryStore = {
      createOrUpdate: vi.fn(() => ({ id: 1, isNew: true })),
      findByFeed: vi.fn(() => ({ entries: [] })),
    } as unknown as EntryStore;
    const parser: IFeedParserAdapter = {
      parse: vi.fn().mockResolvedValue({ feedUrl: TEST_FEED.feedURL, entries: [] }),
    };
    const service = new FeedService(feedStore, entryStore, {
      info: () => {
        throw new Error('logger failure');
      },
      error: () => {
        throw new Error('logger failure');
      },
    }, parser);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<rss />'),
    });

    await expect(service.addFeed(TEST_FEED.feedURL)).resolves.toEqual({
      feed: TEST_FEED,
      entries: [],
    });
  });

  it('maps startup, scheduled, and explicit scheduler runs to the internal trigger enum', async () => {
    vi.useFakeTimers();
    const syncAll = vi.fn().mockResolvedValue([]);
    const coordinator = {
      syncAll,
      cancelAll: vi.fn(),
    } as unknown as SyncCoordinator;
    const scheduler = new SyncScheduler({} as FeedStore, coordinator, { intervalMin: 1 });

    try {
      scheduler.start();
      expect(syncAll).toHaveBeenCalledWith('startup');

      await vi.advanceTimersByTimeAsync(60_000);
      expect(syncAll).toHaveBeenCalledWith('scheduled');

      await scheduler.triggerNow();
      expect(syncAll).toHaveBeenLastCalledWith('manual');
    } finally {
      scheduler.stop();
      vi.useRealTimers();
    }
  });

  it('rejects a non-enumerated trigger before any sync logging is emitted', async () => {
    const { coordinator, feedLogger } = createCoordinatorForSyncTests(
      vi.fn().mockResolvedValue({ feed: TEST_FEED, newCount: 0, entries: [] }),
    );

    await expect(coordinator.syncAll('renderer-value' as never)).rejects.toThrow(
      'Invalid internal feed sync trigger',
    );

    expect(feedLogger.records).toEqual([]);
  });
});
