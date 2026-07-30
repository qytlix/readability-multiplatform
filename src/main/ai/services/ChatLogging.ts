import { performance } from 'node:perf_hooks';
import type { ChatErrorCode } from '../../../shared/errors/chat.errors';

export const CHAT_LOG_EVENTS = {
  runStarted: 'chat.run.started',
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

interface ChatRecoveryContext {
  durationMs: number;
  count: number;
}

/** Deliberately excludes questions, article text, prompts, paths, and secrets. */
export interface ChatOperationLogger {
  info(
    event:
      | typeof CHAT_LOG_EVENTS.runStarted
      | typeof CHAT_LOG_EVENTS.runCompleted
      | typeof CHAT_LOG_EVENTS.recoveryCompleted,
    component: typeof CHAT_RUN_COMPONENT | typeof CHAT_RECOVERY_COMPONENT,
    context: ChatRunStartContext | ChatRunResultContext | ChatRecoveryContext,
  ): void;
  warn(
    event: typeof CHAT_LOG_EVENTS.runInterrupted,
    component: typeof CHAT_RUN_COMPONENT,
    context: ChatRunResultContext,
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

export function logChatRunCompleted(
  logger: ChatOperationLogger | undefined,
  context: Omit<ChatRunResultContext, 'success' | 'errorCode'>,
): void {
  if (!isSafeId(context.taskRunId) || !isSafeCount(context.durationMs)) return;
  try {
    logger?.info(CHAT_LOG_EVENTS.runCompleted, CHAT_RUN_COMPONENT, {
      ...context,
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
      ...context,
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
      ...context,
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
    logger?.info(CHAT_LOG_EVENTS.recoveryCompleted, CHAT_RECOVERY_COMPONENT, context);
  } catch {
    // Observability must never change Chat recovery.
  }
}

function isSafeId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isSafeCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
