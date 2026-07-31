import { performance } from 'node:perf_hooks';
import type { ChatContextMode } from '../../../shared/contracts/chat.types';
import type { ChatErrorCode } from '../../../shared/errors/chat.errors';

export const CHAT_LOG_EVENTS = {
  runStarted: 'chat.run.started',
  contextCompleted: 'chat.run.context.completed',
  providerResponseHeaders: 'chat.run.provider.response.headers',
  providerFirstDelta: 'chat.run.provider.first.delta',
  providerCompleted: 'chat.run.provider.completed',
  runRetrying: 'chat.run.retrying',
  runCompleted: 'chat.run.completed',
  runFailed: 'chat.run.failed',
  runInterrupted: 'chat.run.interrupted',
  recoveryCompleted: 'chat.recovery.completed',
} as const;

const CHAT_RUN_COMPONENT = 'chat.run';
const CHAT_RECOVERY_COMPONENT = 'chat.recovery';

interface ChatRunStartContext {
  taskRunId: number;
}

interface ChatRunResultContext {
  taskRunId: number;
  durationMs: number;
  success: boolean;
  errorCode?: ChatErrorCode;
}

interface ChatRunRetryContext {
  taskRunId: number;
  attemptCount: number;
  errorCode: ChatErrorCode;
}

type ChatContextResultContext = {
  taskRunId: number;
  durationMs: number;
} & (
  | {
      success: true;
      contextMode: ChatContextMode;
      inputTokens: number;
    }
  | {
      success: false;
      errorCode: ChatErrorCode;
    }
);

interface ChatProviderTimingContext {
  taskRunId: number;
  durationMs: number;
  attemptCount: number;
}

interface ChatRecoveryContext {
  durationMs: number;
  count: number;
}

/** Deliberately excludes questions, article text, prompts, paths, and secrets. */
export interface ChatOperationLogger {
  info(
    event:
      | typeof CHAT_LOG_EVENTS.runStarted
      | typeof CHAT_LOG_EVENTS.contextCompleted
      | typeof CHAT_LOG_EVENTS.providerResponseHeaders
      | typeof CHAT_LOG_EVENTS.providerFirstDelta
      | typeof CHAT_LOG_EVENTS.providerCompleted
      | typeof CHAT_LOG_EVENTS.runCompleted
      | typeof CHAT_LOG_EVENTS.recoveryCompleted,
    component: typeof CHAT_RUN_COMPONENT | typeof CHAT_RECOVERY_COMPONENT,
    context:
      | ChatRunStartContext
      | ChatContextResultContext
      | ChatProviderTimingContext
      | ChatRunResultContext
      | ChatRecoveryContext,
  ): void;
  warn(
    event:
      | typeof CHAT_LOG_EVENTS.runRetrying
      | typeof CHAT_LOG_EVENTS.runInterrupted,
    component: typeof CHAT_RUN_COMPONENT,
    context: ChatRunRetryContext | ChatRunResultContext,
  ): void;
  error(
    event: typeof CHAT_LOG_EVENTS.runFailed,
    component: typeof CHAT_RUN_COMPONENT,
    context: ChatRunResultContext,
  ): void;
}

export function elapsedChatMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export function logChatRunStarted(
  logger: ChatOperationLogger | undefined,
  taskRunId: number,
): void {
  if (!isSafeId(taskRunId)) return;
  try {
    logger?.info(CHAT_LOG_EVENTS.runStarted, CHAT_RUN_COMPONENT, { taskRunId });
  } catch {
    // Observability must never change Chat behavior.
  }
}

export function logChatContextCompleted(
  logger: ChatOperationLogger | undefined,
  context: ChatContextResultContext,
): void {
  if (!isSafeId(context.taskRunId) || !isSafeCount(context.durationMs)) return;
  try {
    if (context.success) {
      if (!isSafeCount(context.inputTokens)) return;
      logger?.info(CHAT_LOG_EVENTS.contextCompleted, CHAT_RUN_COMPONENT, {
        taskRunId: context.taskRunId,
        durationMs: context.durationMs,
        success: true,
        contextMode: context.contextMode,
        inputTokens: context.inputTokens,
      });
      return;
    }
    logger?.info(CHAT_LOG_EVENTS.contextCompleted, CHAT_RUN_COMPONENT, {
      taskRunId: context.taskRunId,
      durationMs: context.durationMs,
      success: false,
      errorCode: context.errorCode,
    });
  } catch {
    // Observability must never change Chat behavior.
  }
}

export function logChatProviderResponseHeaders(
  logger: ChatOperationLogger | undefined,
  context: ChatProviderTimingContext,
): void {
  logChatProviderTiming(
    logger,
    CHAT_LOG_EVENTS.providerResponseHeaders,
    context,
  );
}

export function logChatProviderFirstDelta(
  logger: ChatOperationLogger | undefined,
  context: ChatProviderTimingContext,
): void {
  logChatProviderTiming(logger, CHAT_LOG_EVENTS.providerFirstDelta, context);
}

export function logChatProviderCompleted(
  logger: ChatOperationLogger | undefined,
  context: ChatProviderTimingContext,
): void {
  logChatProviderTiming(logger, CHAT_LOG_EVENTS.providerCompleted, context);
}

export function logChatRunRetrying(
  logger: ChatOperationLogger | undefined,
  context: ChatRunRetryContext,
): void {
  if (
    !isSafeId(context.taskRunId)
    || !isSafeId(context.attemptCount)
  ) {
    return;
  }
  try {
    logger?.warn(CHAT_LOG_EVENTS.runRetrying, CHAT_RUN_COMPONENT, {
      taskRunId: context.taskRunId,
      attemptCount: context.attemptCount,
      errorCode: context.errorCode,
    });
  } catch {
    // Observability must never change Chat retry behavior.
  }
}

export function logChatRunCompleted(
  logger: ChatOperationLogger | undefined,
  context: Omit<ChatRunResultContext, 'success' | 'errorCode'>,
): void {
  if (!isSafeId(context.taskRunId) || !isSafeCount(context.durationMs)) return;
  try {
    logger?.info(CHAT_LOG_EVENTS.runCompleted, CHAT_RUN_COMPONENT, {
      taskRunId: context.taskRunId,
      durationMs: context.durationMs,
      success: true,
    });
  } catch {
    // Observability must never change Chat behavior.
  }
}

export function logChatRunFailed(
  logger: ChatOperationLogger | undefined,
  context: Omit<ChatRunResultContext, 'success'> & { errorCode: ChatErrorCode },
): void {
  if (!isSafeId(context.taskRunId) || !isSafeCount(context.durationMs)) return;
  try {
    logger?.error(CHAT_LOG_EVENTS.runFailed, CHAT_RUN_COMPONENT, {
      taskRunId: context.taskRunId,
      durationMs: context.durationMs,
      errorCode: context.errorCode,
      success: false,
    });
  } catch {
    // Observability must never change Chat behavior.
  }
}

export function logChatRunInterrupted(
  logger: ChatOperationLogger | undefined,
  context: Omit<ChatRunResultContext, 'success'> & { errorCode: ChatErrorCode },
): void {
  if (!isSafeId(context.taskRunId) || !isSafeCount(context.durationMs)) return;
  try {
    logger?.warn(CHAT_LOG_EVENTS.runInterrupted, CHAT_RUN_COMPONENT, {
      taskRunId: context.taskRunId,
      durationMs: context.durationMs,
      errorCode: context.errorCode,
      success: false,
    });
  } catch {
    // Observability must never change Chat behavior.
  }
}

export function logChatRecoveryCompleted(
  logger: ChatOperationLogger | undefined,
  context: ChatRecoveryContext,
): void {
  if (!isSafeCount(context.durationMs) || !isSafeCount(context.count)) return;
  try {
    logger?.info(CHAT_LOG_EVENTS.recoveryCompleted, CHAT_RECOVERY_COMPONENT, {
      durationMs: context.durationMs,
      count: context.count,
    });
  } catch {
    // Observability must never change Chat recovery.
  }
}

function isSafeId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function logChatProviderTiming(
  logger: ChatOperationLogger | undefined,
  event:
    | typeof CHAT_LOG_EVENTS.providerResponseHeaders
    | typeof CHAT_LOG_EVENTS.providerFirstDelta
    | typeof CHAT_LOG_EVENTS.providerCompleted,
  context: ChatProviderTimingContext,
): void {
  if (
    !isSafeId(context.taskRunId)
    || !isSafeCount(context.durationMs)
    || !isSafeId(context.attemptCount)
  ) {
    return;
  }
  try {
    logger?.info(event, CHAT_RUN_COMPONENT, {
      taskRunId: context.taskRunId,
      durationMs: context.durationMs,
      attemptCount: context.attemptCount,
    });
  } catch {
    // Observability must never change Chat behavior.
  }
}

function isSafeCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
