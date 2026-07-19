import { FeedService, type SyncResult } from './FeedService';
import type { Feed } from '../../../shared/contracts/feed.types';

export interface SyncAllResult {
  feedId: number;
  success: boolean;
  error?: string;
  newCount: number;
}

type FeedSyncInProgress = Map<number, AbortController>;

/**
 * Coordinates feed sync operations with concurrency control.
 * - Concurrent sync of multiple feeds up to configurable max
 * - Single feed dedup (no concurrent sync of same feed)
 * - Global cancel via AbortController
 * - Individual feed failure doesn't block others
 */
export class SyncCoordinator {
  private feedService: FeedService;
  private inProgress: FeedSyncInProgress = new Map();
  private globalAbortController: AbortController | null = null;
  private maxConcurrency: number;
  private onFeedProgress?: (feedId: number, status: string, feedTitle: string, newCount: number, error?: string) => void;

  constructor(
    feedService: FeedService,
    options?: {
      maxConcurrency?: number;
      onFeedProgress?: (feedId: number, status: string, feedTitle: string, newCount: number, error?: string) => void;
    },
  ) {
    this.feedService = feedService;
    this.maxConcurrency = options?.maxConcurrency ?? 6;
    this.onFeedProgress = options?.onFeedProgress;
  }

  /**
   * Sync a single feed, preventing concurrent sync for the same feed.
   */
  async syncFeed(feedId: number): Promise<SyncResult> {
    // If already syncing this feed, wait for it to complete
    if (this.inProgress.has(feedId)) {
      throw new Error(`Feed ${feedId} is already being synced`);
    }

    const controller = new AbortController();
    this.inProgress.set(feedId, controller);

    try {
      this.emitProgress(feedId, 'fetching');
      const result = await this.feedService.syncFeed(feedId);
      this.emitProgress(feedId, 'done', result.feed.title ?? '', result.newCount);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitProgress(feedId, 'error', '', 0, message);
      throw error;
    } finally {
      this.inProgress.delete(feedId);
    }
  }

  /**
   * Sync all active feeds with concurrency control.
   * Returns per-feed results — individual failures don't block others.
   */
  async syncAll(): Promise<SyncAllResult[]> {
    this.globalAbortController = new AbortController();
    const signal = this.globalAbortController.signal;

    const feeds = this.feedService.getFeedsSync();
    const results: SyncAllResult[] = [];

    // Process feeds with concurrency limit
    const queue = [...feeds];
    const running: Promise<void>[] = [];

    const processNext = async (): Promise<void> => {
      while (queue.length > 0 && !signal.aborted) {
        const feed = queue.shift()!;

        // Skip if this feed is already being synced
        if (this.inProgress.has(feed.id)) {
          results.push({
            feedId: feed.id,
            success: false,
            error: 'Already syncing',
            newCount: 0,
          });
          continue;
        }

        const controller = new AbortController();
        this.inProgress.set(feed.id, controller);

        try {
          this.emitProgress(feed.id, 'fetching', feed.title ?? '');
          const syncResult = await this.feedService.syncFeed(feed.id);
          this.emitProgress(feed.id, 'done', feed.title ?? '', syncResult.newCount);
          results.push({
            feedId: feed.id,
            success: true,
            newCount: syncResult.newCount,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.emitProgress(feed.id, 'error', feed.title ?? '', 0, message);
          results.push({
            feedId: feed.id,
            success: false,
            error: message,
            newCount: 0,
          });
        } finally {
          this.inProgress.delete(feed.id);
        }
      }
    };

    // Start up to maxConcurrency workers
    const workerCount = Math.min(this.maxConcurrency, queue.length || 1);
    for (let i = 0; i < workerCount; i++) {
      running.push(processNext());
    }

    await Promise.all(running);

    this.globalAbortController = null;
    return results;
  }

  /**
   * Cancel all ongoing sync operations.
   */
  cancelAll(): void {
    if (this.globalAbortController) {
      this.globalAbortController.abort();
      this.globalAbortController = null;
    }

    // Cancel any individual feed syncs not covered by global abort
    for (const [feedId, controller] of this.inProgress) {
      controller.abort();
    }
    this.inProgress.clear();
  }

  /**
   * Check if a feed is currently being synced.
   */
  isFeedSyncing(feedId: number): boolean {
    return this.inProgress.has(feedId);
  }

  /**
   * Get the count of feeds currently being synced.
   */
  get pendingCount(): number {
    return this.inProgress.size;
  }

  /**
   * Update max concurrency (applies to next syncAll call).
   */
  setMaxConcurrency(max: number): void {
    this.maxConcurrency = Math.max(1, Math.min(10, max));
  }

  private emitProgress(
    feedId: number,
    status: string,
    feedTitle?: string,
    newCount?: number,
    error?: string,
  ): void {
    this.onFeedProgress?.(feedId, status, feedTitle ?? '', newCount ?? 0, error);
  }
}