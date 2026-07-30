import type { ShaleError } from '../contracts/feed.ipc';
import { SUMMARY_ERROR_CODES, toSummaryIpcError } from './summary.errors';

export const CHAT_ERROR_CODES = {
  invalidRequest: 'CHAT_INVALID_REQUEST',
  contentUnavailable: 'CHAT_CONTENT_UNAVAILABLE',
  providerNotConfigured: 'CHAT_PROVIDER_NOT_CONFIGURED',
  busy: 'CHAT_BUSY',
  contextTooLarge: 'CHAT_CONTEXT_TOO_LARGE',
  emptyOutput: 'CHAT_EMPTY_OUTPUT',
  interrupted: 'CHAT_INTERRUPTED',
  providerFailed: 'CHAT_PROVIDER_FAILED',
} as const;

export class ChatError extends Error {
  override readonly name = 'ChatError';

  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

export function toChatIpcError(error: unknown): ShaleError {
  if (error instanceof ChatError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  const providerError = toSummaryIpcError(error);
  if (providerError.code === SUMMARY_ERROR_CODES.SUMMARY_INTERRUPTED) {
    return {
      code: CHAT_ERROR_CODES.interrupted,
      message: 'AI 问答已停止。',
      retryable: true,
    };
  }
  return {
    code: CHAT_ERROR_CODES.providerFailed,
    message: providerError.message,
    retryable: providerError.retryable,
  };
}
