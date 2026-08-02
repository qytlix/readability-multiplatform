import { performance } from 'node:perf_hooks';

export const ENTRY_LIST_LOG_EVENT = 'entry.list.failed' as const;
export const ENTRY_LIST_LOG_COMPONENT = 'entry.list' as const;
export const ENTRY_LIST_LOG_ERROR_CODE = 'ENTRY_LIST_READ_FAILED' as const;

export interface EntryListFailureLogContext {
  stage: 'read';
  errorCode: typeof ENTRY_LIST_LOG_ERROR_CODE;
  durationMs: number;
  success: false;
}

/** The limited logging surface for a terminal article-list read failure. */
export interface EntryListOperationLogger {
  error(
    event: typeof ENTRY_LIST_LOG_EVENT,
    component: typeof ENTRY_LIST_LOG_COMPONENT,
    context: EntryListFailureLogContext,
  ): void;
}

export function elapsedEntryListMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export function logEntryListFailure(
  logger: EntryListOperationLogger | undefined,
  context: EntryListFailureLogContext,
): void {
  if (
    context.stage !== 'read'
    || context.errorCode !== ENTRY_LIST_LOG_ERROR_CODE
    || !Number.isSafeInteger(context.durationMs)
    || context.durationMs < 0
    || context.success !== false
  ) {
    return;
  }

  try {
    logger?.error(ENTRY_LIST_LOG_EVENT, ENTRY_LIST_LOG_COMPONENT, {
      stage: 'read',
      errorCode: ENTRY_LIST_LOG_ERROR_CODE,
      durationMs: context.durationMs,
      success: false,
    });
  } catch {
    // Diagnostics must not change the list result returned to the Renderer.
  }
}
