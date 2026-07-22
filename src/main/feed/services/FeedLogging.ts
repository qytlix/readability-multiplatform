import { performance } from 'node:perf_hooks';
import type { StructuredLogContext } from '../../logging/StructuredLogger';

export const FEED_SYNC_TRIGGERS = ['startup', 'scheduled', 'manual'] as const;

export type FeedSyncTrigger = (typeof FEED_SYNC_TRIGGERS)[number];

export const FEED_LOG_EVENTS = {
  addCompleted: 'feed.add.completed',
  addFailed: 'feed.add.failed',
  syncRunStarted: 'feed.sync.run.started',
  syncRunCompleted: 'feed.sync.run.completed',
  syncFeedFailed: 'feed.sync.feed.failed',
  syncRunFailed: 'feed.sync.run.failed',
} as const;

export const FEED_LOG_COMPONENTS = {
  service: 'feed.service',
  sync: 'feed.sync',
} as const;

export type FeedLogEvent = (typeof FEED_LOG_EVENTS)[keyof typeof FEED_LOG_EVENTS];
export type FeedLogComponent = (typeof FEED_LOG_COMPONENTS)[keyof typeof FEED_LOG_COMPONENTS];
export type FeedLogContext = Pick<
  StructuredLogContext,
  | 'feedId'
  | 'durationMs'
  | 'errorCode'
  | 'trigger'
  | 'success'
  | 'successCount'
  | 'failureCount'
  | 'newCount'
>;

export interface FeedOperationLogger {
  info(event: string, component: string, context?: FeedLogContext): void;
  error(event: string, component: string, context?: FeedLogContext): void;
}

export function assertFeedSyncTrigger(value: unknown): asserts value is FeedSyncTrigger {
  if (!FEED_SYNC_TRIGGERS.includes(value as FeedSyncTrigger)) {
    throw new Error('Invalid internal feed sync trigger');
  }
}

export function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export function logFeedOperation(
  logger: FeedOperationLogger,
  level: 'info' | 'error',
  event: FeedLogEvent,
  component: FeedLogComponent,
  context: FeedLogContext,
): void {
  try {
    logger[level](event, component, context);
  } catch {
    // Logging must not change Feed operation results or error propagation.
  }
}
