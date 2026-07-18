import { FeedStore } from '../stores/FeedStore';
import { SyncCoordinator, type SyncAllResult } from './SyncCoordinator';

/**
 * Minimal periodic sync scheduler.
 * - On start: immediately triggers first sync cycle
 * - Subsequent cycles at configured interval
 * - All active feeds are synced per cycle (concurrent via SyncCoordinator)
 * - New feeds added after start are included in next cycle
 * - App exit: call stop() to clean up timer
 */
export class SyncScheduler {
  private feedStore: FeedStore;
  private coordinator: SyncCoordinator;
  private intervalMs: number;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private cycleInProgress = false;
  private onCycleComplete?: (results: SyncAllResult[]) => void;

  constructor(
    feedStore: FeedStore,
    coordinator: SyncCoordinator,
    options?: {
      intervalMin?: number;
      onCycleComplete?: (results: SyncAllResult[]) => void;
    },
  ) {
    this.feedStore = feedStore;
    this.coordinator = coordinator;
    this.intervalMs = (options?.intervalMin ?? 30) * 60 * 1000;
    this.onCycleComplete = options?.onCycleComplete;
  }

  /**
   * Start the scheduler. Fires first sync immediately, then at interval.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // First cycle immediately
    this.runCycle();

    // Subsequent cycles at interval
    this.timerId = setInterval(() => {
      this.runCycle();
    }, this.intervalMs);
  }

  /**
   * Stop the scheduler. Cancels any in-progress cycle and clears timer.
   */
  stop(): void {
    this.running = false;

    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    this.coordinator.cancelAll();
  }

  /**
   * Update the sync interval. Takes effect on next cycle.
   */
  setInterval(minutes: number): void {
    const newMs = minutes * 60 * 1000;
    if (newMs === this.intervalMs) return;

    this.intervalMs = newMs;

    // Restart timer with new interval if currently running
    if (this.running && this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = setInterval(() => {
        this.runCycle();
      }, this.intervalMs);
    }
  }

  /**
   * Check if the scheduler is currently running.
   */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Check if a sync cycle is currently in progress.
   */
  get isCycleInProgress(): boolean {
    return this.cycleInProgress;
  }

  /**
   * Trigger an immediate sync cycle (won't overlap with an existing one).
   */
  async triggerNow(): Promise<SyncAllResult[]> {
    return this.runCycle();
  }

  private async runCycle(): Promise<SyncAllResult[]> {
    if (!this.running || this.cycleInProgress) return [];

    this.cycleInProgress = true;

    try {
      const results = await this.coordinator.syncAll();
      this.onCycleComplete?.(results);
      return results;
    } finally {
      this.cycleInProgress = false;
    }
  }
}