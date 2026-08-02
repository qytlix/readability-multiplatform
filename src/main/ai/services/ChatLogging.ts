import { performance } from 'node:perf_hooks';
import {
  CHAT_ERROR_CODES,
  type ChatErrorCode,
} from '../../../shared/errors/chat.errors';

export const CHAT_LOG_EVENTS = {
  runFailed: 'chat.run.failed',
  sessionPersistenceFailed: 'chat.session.persistence.failed',
  attachmentOperationFailed: 'chat.attachment.operation.failed',
} as const;

export const CHAT_LOG_COMPONENTS = {
  run: 'chat.run',
  session: 'chat.session',
  attachment: 'chat.attachment',
} as const;

export const CHAT_LOG_OPERATIONS = [
  'load',
  'send',
  'retry',
  'regenerate',
  'import',
  'remove',
  'preview',
  'cleanup',
] as const;

export type ChatLogOperation = (typeof CHAT_LOG_OPERATIONS)[number];
export type ChatRunLogOperation = Extract<
  ChatLogOperation,
  'send' | 'retry' | 'regenerate'
>;
export type ChatAttachmentLogOperation = Exclude<ChatLogOperation, 'load'>;

export const CHAT_RUN_FAILURE_STAGES = [
  'context-preparation',
  'provider',
  'empty-response',
  'event-listener',
] as const;
export type ChatRunFailureStage = (typeof CHAT_RUN_FAILURE_STAGES)[number];

export const CHAT_SESSION_FAILURE_STAGES = [
  'session-load',
  'thread-load-or-create',
  'run-reserve',
  'attachment-link',
  'context-finalize',
  'delta-append',
  'run-finalize',
  'run-fail',
] as const;
export type ChatSessionFailureStage = (
  typeof CHAT_SESSION_FAILURE_STAGES
)[number];

export const CHAT_ATTACHMENT_FAILURE_STAGES = [
  'file-read',
  'file-write',
  'database-read',
  'database-write',
  'cleanup',
] as const;
export type ChatAttachmentFailureStage = (
  typeof CHAT_ATTACHMENT_FAILURE_STAGES
)[number];

export const CHAT_LOG_ERROR_CODES = {
  sessionPersistenceFailed: 'CHAT_SESSION_PERSISTENCE_FAILED',
  attachmentOperationFailed: 'CHAT_ATTACHMENT_OPERATION_FAILED',
  eventListenerFailed: 'CHAT_EVENT_LISTENER_FAILED',
} as const;

export const CHAT_RUN_LOG_ERROR_CODES = [
  ...Object.values(CHAT_ERROR_CODES),
  CHAT_LOG_ERROR_CODES.eventListenerFailed,
] as const;

export type ChatRunLogErrorCode =
  | ChatErrorCode
  | typeof CHAT_LOG_ERROR_CODES.eventListenerFailed;

export interface ChatFailureTerminal {
  recorded: boolean;
}

interface ChatFailureContextBase {
  operation: ChatLogOperation;
  finalFailureStage:
    | ChatRunFailureStage
    | ChatSessionFailureStage
    | ChatAttachmentFailureStage;
  durationMs: number;
  success: false;
  errorCode: string;
  taskRunId?: number;
}

export type ChatRunFailedLogContext = ChatFailureContextBase & {
  operation: ChatRunLogOperation;
  finalFailureStage: ChatRunFailureStage;
  errorCode: ChatRunLogErrorCode;
  taskRunId: number;
};

export type ChatSessionPersistenceFailedLogContext = ChatFailureContextBase & {
  operation: 'load' | ChatRunLogOperation;
  finalFailureStage: ChatSessionFailureStage;
  errorCode: typeof CHAT_LOG_ERROR_CODES.sessionPersistenceFailed;
};

export type ChatAttachmentOperationFailedLogContext = ChatFailureContextBase & {
  operation: ChatAttachmentLogOperation;
  finalFailureStage: ChatAttachmentFailureStage;
  errorCode: typeof CHAT_LOG_ERROR_CODES.attachmentOperationFailed;
};

/** Chat logs are failure terminals only and never accept free-form context. */
export interface ChatOperationLogger {
  error(
    event: (typeof CHAT_LOG_EVENTS)[keyof typeof CHAT_LOG_EVENTS],
    component: (typeof CHAT_LOG_COMPONENTS)[keyof typeof CHAT_LOG_COMPONENTS],
    context: ChatFailureContextBase,
  ): void;
}

export function createChatFailureTerminal(): ChatFailureTerminal {
  return { recorded: false };
}

export function elapsedChatMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export function logChatRunFailed(
  logger: ChatOperationLogger | undefined,
  terminal: ChatFailureTerminal,
  context: ChatRunFailedLogContext,
): void {
  if (
    !isSafeRunContext(context)
    || !claimTerminal(terminal)
  ) return;
  writeFailure(
    logger,
    CHAT_LOG_EVENTS.runFailed,
    CHAT_LOG_COMPONENTS.run,
    context,
  );
}

export function logChatSessionPersistenceFailed(
  logger: ChatOperationLogger | undefined,
  terminal: ChatFailureTerminal,
  context: ChatSessionPersistenceFailedLogContext,
): void {
  if (
    !isSafeBaseContext(context)
    || !['load', 'send', 'retry', 'regenerate'].includes(context.operation)
    || !CHAT_SESSION_FAILURE_STAGES.includes(context.finalFailureStage)
    || context.errorCode !== CHAT_LOG_ERROR_CODES.sessionPersistenceFailed
    || !claimTerminal(terminal)
  ) return;
  writeFailure(
    logger,
    CHAT_LOG_EVENTS.sessionPersistenceFailed,
    CHAT_LOG_COMPONENTS.session,
    context,
  );
}

export function logChatAttachmentOperationFailed(
  logger: ChatOperationLogger | undefined,
  terminal: ChatFailureTerminal,
  context: ChatAttachmentOperationFailedLogContext,
): void {
  if (
    !isSafeBaseContext(context)
    || !CHAT_ATTACHMENT_FAILURE_STAGES.includes(context.finalFailureStage)
    || context.errorCode !== CHAT_LOG_ERROR_CODES.attachmentOperationFailed
    || !claimTerminal(terminal)
  ) return;
  writeFailure(
    logger,
    CHAT_LOG_EVENTS.attachmentOperationFailed,
    CHAT_LOG_COMPONENTS.attachment,
    context,
  );
}

function claimTerminal(terminal: ChatFailureTerminal): boolean {
  if (terminal.recorded) return false;
  terminal.recorded = true;
  return true;
}

function isSafeRunContext(context: ChatRunFailedLogContext): boolean {
  return isSafeBaseContext(context)
    && ['send', 'retry', 'regenerate'].includes(context.operation)
    && CHAT_RUN_FAILURE_STAGES.includes(context.finalFailureStage)
    && CHAT_RUN_LOG_ERROR_CODES.includes(context.errorCode)
    && isSafeId(context.taskRunId);
}

function isSafeBaseContext(context: ChatFailureContextBase): boolean {
  return CHAT_LOG_OPERATIONS.includes(context.operation)
    && isSafeCount(context.durationMs)
    && context.success === false
    && (
      context.taskRunId === undefined
      || isSafeId(context.taskRunId)
    );
}

function writeFailure(
  logger: ChatOperationLogger | undefined,
  event: (typeof CHAT_LOG_EVENTS)[keyof typeof CHAT_LOG_EVENTS],
  component: (typeof CHAT_LOG_COMPONENTS)[keyof typeof CHAT_LOG_COMPONENTS],
  context: ChatFailureContextBase,
): void {
  try {
    logger?.error(event, component, {
      operation: context.operation,
      finalFailureStage: context.finalFailureStage,
      durationMs: context.durationMs,
      success: false,
      errorCode: context.errorCode,
      ...(context.taskRunId === undefined
        ? {}
        : { taskRunId: context.taskRunId }),
    });
  } catch {
    // Observability must never change Chat behavior.
  }
}

function isSafeId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isSafeCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
