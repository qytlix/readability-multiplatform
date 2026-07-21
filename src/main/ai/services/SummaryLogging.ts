import { performance } from 'node:perf_hooks';

export const SUMMARY_LOG_EVENTS = {
  runStarted: 'summary.run.started',
  runCompleted: 'summary.run.completed',
  runFailed: 'summary.run.failed',
  runInterrupted: 'summary.run.interrupted',
  recoveryCompleted: 'summary.recovery.completed',
} as const;

export const SUMMARY_LOG_COMPONENTS = {
  run: 'summary.run',
  recovery: 'summary.recovery',
} as const;

export const SUMMARY_RUN_FAILURE_STAGES = ['stream', 'persist'] as const;

export const SUMMARY_LOG_ERROR_CODES = {
  emptyOutput: 'SUMMARY_EMPTY_OUTPUT',
  providerAuth: 'SUMMARY_PROVIDER_AUTH',
  providerRequestFailed: 'SUMMARY_PROVIDER_REQUEST_FAILED',
  providerTimeout: 'SUMMARY_PROVIDER_TIMEOUT',
  networkError: 'SUMMARY_NETWORK_ERROR',
  unknownError: 'SUMMARY_UNKNOWN_ERROR',
  interrupted: 'SUMMARY_INTERRUPTED',
} as const;

export type SummaryRunFailureStage = (typeof SUMMARY_RUN_FAILURE_STAGES)[number];
export type SummaryLogErrorCode = (
  typeof SUMMARY_LOG_ERROR_CODES
)[keyof typeof SUMMARY_LOG_ERROR_CODES];

export interface SummaryRunStartedLogContext {
  taskRunId: number;
}

export interface SummaryRunCompletedLogContext {
  taskRunId: number;
  durationMs: number;
  success: true;
}

export interface SummaryRunFailedLogContext {
  taskRunId: number;
  durationMs: number;
  success: false;
  stage: SummaryRunFailureStage;
  errorCode: SummaryLogErrorCode;
}

export interface SummaryRunInterruptedLogContext {
  taskRunId: number;
  durationMs: number;
  success: false;
  stage: 'interrupt';
  errorCode: typeof SUMMARY_LOG_ERROR_CODES.interrupted;
}

export interface SummaryRecoveryCompletedLogContext {
  durationMs: number;
  count: number;
}

const SUMMARY_RUN_FAILURE_ERROR_CODES_BY_STAGE = {
  stream: [
    SUMMARY_LOG_ERROR_CODES.emptyOutput,
    SUMMARY_LOG_ERROR_CODES.providerAuth,
    SUMMARY_LOG_ERROR_CODES.providerRequestFailed,
    SUMMARY_LOG_ERROR_CODES.providerTimeout,
    SUMMARY_LOG_ERROR_CODES.networkError,
    SUMMARY_LOG_ERROR_CODES.unknownError,
  ],
  persist: [SUMMARY_LOG_ERROR_CODES.unknownError],
} as const satisfies Record<SummaryRunFailureStage, readonly SummaryLogErrorCode[]>;

/** The limited logging surface required by Summary task lifecycle operations. */
export interface SummaryOperationLogger {
  info(
    event:
      | typeof SUMMARY_LOG_EVENTS.runStarted
      | typeof SUMMARY_LOG_EVENTS.runCompleted
      | typeof SUMMARY_LOG_EVENTS.recoveryCompleted,
    component:
      | typeof SUMMARY_LOG_COMPONENTS.run
      | typeof SUMMARY_LOG_COMPONENTS.recovery,
    context:
      | SummaryRunStartedLogContext
      | SummaryRunCompletedLogContext
      | SummaryRecoveryCompletedLogContext,
  ): void;
  warn(
    event: typeof SUMMARY_LOG_EVENTS.runInterrupted,
    component: typeof SUMMARY_LOG_COMPONENTS.run,
    context: SummaryRunInterruptedLogContext,
  ): void;
  error(
    event: typeof SUMMARY_LOG_EVENTS.runFailed,
    component: typeof SUMMARY_LOG_COMPONENTS.run,
    context: SummaryRunFailedLogContext,
  ): void;
}

export function elapsedSummaryMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export function logSummaryRunStarted(
  logger: SummaryOperationLogger | undefined,
  context: SummaryRunStartedLogContext,
): void {
  if (!isSafeTaskRunId(context.taskRunId)) return;

  try {
    logger?.info(SUMMARY_LOG_EVENTS.runStarted, SUMMARY_LOG_COMPONENTS.run, {
      taskRunId: context.taskRunId,
    });
  } catch {
    // Logging is observational and must not change Summary task behavior.
  }
}

export function logSummaryRunCompleted(
  logger: SummaryOperationLogger | undefined,
  context: SummaryRunCompletedLogContext,
): void {
  if (
    !isSafeTaskRunId(context.taskRunId)
    || !isSafeDuration(context.durationMs)
    || context.success !== true
  ) {
    return;
  }

  try {
    logger?.info(SUMMARY_LOG_EVENTS.runCompleted, SUMMARY_LOG_COMPONENTS.run, {
      taskRunId: context.taskRunId,
      durationMs: context.durationMs,
      success: true,
    });
  } catch {
    // Logging is observational and must not change Summary task behavior.
  }
}

export function logSummaryRunFailed(
  logger: SummaryOperationLogger | undefined,
  context: SummaryRunFailedLogContext,
): void {
  if (
    !isSafeTaskRunId(context.taskRunId)
    || !isSafeDuration(context.durationMs)
    || !isAllowedRunFailure(context.stage, context.errorCode)
  ) {
    return;
  }

  try {
    logger?.error(SUMMARY_LOG_EVENTS.runFailed, SUMMARY_LOG_COMPONENTS.run, {
      taskRunId: context.taskRunId,
      durationMs: context.durationMs,
      success: false,
      stage: context.stage,
      errorCode: context.errorCode,
    });
  } catch {
    // Logging is observational and must not change Summary task behavior.
  }
}

export function logSummaryRunInterrupted(
  logger: SummaryOperationLogger | undefined,
  context: SummaryRunInterruptedLogContext,
): void {
  if (
    !isSafeTaskRunId(context.taskRunId)
    || !isSafeDuration(context.durationMs)
    || context.stage !== 'interrupt'
    || context.errorCode !== SUMMARY_LOG_ERROR_CODES.interrupted
  ) {
    return;
  }

  try {
    logger?.warn(SUMMARY_LOG_EVENTS.runInterrupted, SUMMARY_LOG_COMPONENTS.run, {
      taskRunId: context.taskRunId,
      durationMs: context.durationMs,
      success: false,
      stage: 'interrupt',
      errorCode: SUMMARY_LOG_ERROR_CODES.interrupted,
    });
  } catch {
    // Logging is observational and must not change Summary task behavior.
  }
}

export function logSummaryRecoveryCompleted(
  logger: SummaryOperationLogger | undefined,
  context: SummaryRecoveryCompletedLogContext,
): void {
  if (!isSafeDuration(context.durationMs) || !isSafeCount(context.count)) return;

  try {
    logger?.info(SUMMARY_LOG_EVENTS.recoveryCompleted, SUMMARY_LOG_COMPONENTS.recovery, {
      durationMs: context.durationMs,
      count: context.count,
    });
  } catch {
    // Logging is observational and must not change Summary recovery behavior.
  }
}

function isAllowedRunFailure(
  stage: unknown,
  errorCode: unknown,
): stage is SummaryRunFailureStage {
  if (!SUMMARY_RUN_FAILURE_STAGES.includes(stage as SummaryRunFailureStage)) {
    return false;
  }

  return SUMMARY_RUN_FAILURE_ERROR_CODES_BY_STAGE[
    stage as SummaryRunFailureStage
  ].includes(errorCode as never);
}

function isSafeTaskRunId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isSafeDuration(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isSafeCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
