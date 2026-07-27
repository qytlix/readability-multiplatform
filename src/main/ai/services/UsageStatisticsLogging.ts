import { performance } from 'node:perf_hooks';

export const USAGE_STATISTICS_LOG_EVENTS = {
  failed: 'usage.statistics.failed',
} as const;

export const USAGE_STATISTICS_LOG_COMPONENT = 'usage.statistics';

export const USAGE_STATISTICS_LOG_ERROR_CODES = {
  readFailed: 'USAGE_STATISTICS_READ_FAILED',
} as const;

export interface UsageStatisticsFailedLogContext {
  stage: 'read';
  errorCode: typeof USAGE_STATISTICS_LOG_ERROR_CODES.readFailed;
  durationMs: number;
  success: false;
}

/** The limited logging surface for the terminal, read-only Usage Statistics query. */
export interface UsageStatisticsOperationLogger {
  error(
    event: typeof USAGE_STATISTICS_LOG_EVENTS.failed,
    component: typeof USAGE_STATISTICS_LOG_COMPONENT,
    context: UsageStatisticsFailedLogContext,
  ): void;
}

export function elapsedUsageStatisticsMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export function logUsageStatisticsFailed(
  logger: UsageStatisticsOperationLogger | undefined,
  context: UsageStatisticsFailedLogContext,
): void {
  if (
    context.stage !== 'read'
    || context.errorCode !== USAGE_STATISTICS_LOG_ERROR_CODES.readFailed
    || !Number.isSafeInteger(context.durationMs)
    || context.durationMs < 0
    || context.success !== false
  ) {
    return;
  }

  try {
    logger?.error(
      USAGE_STATISTICS_LOG_EVENTS.failed,
      USAGE_STATISTICS_LOG_COMPONENT,
      {
        stage: 'read',
        errorCode: USAGE_STATISTICS_LOG_ERROR_CODES.readFailed,
        durationMs: context.durationMs,
        success: false,
      },
    );
  } catch {
    // Diagnostics must not change the query result returned to the Renderer.
  }
}
