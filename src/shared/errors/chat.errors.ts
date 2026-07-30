import type { ShaleError } from '../contracts/feed.ipc';
import { SummaryError } from './summary.errors';

export const CHAT_ERROR_CODES = {
  CHAT_PROVIDER_NOT_CONFIGURED: 'CHAT_PROVIDER_NOT_CONFIGURED',
  CHAT_CONTENT_UNAVAILABLE: 'CHAT_CONTENT_UNAVAILABLE',
  CHAT_BUSY: 'CHAT_BUSY',
  CHAT_INTERRUPTED: 'CHAT_INTERRUPTED',
  CHAT_EMPTY_OUTPUT: 'CHAT_EMPTY_OUTPUT',
  CHAT_CONTEXT_TOO_LARGE: 'CHAT_CONTEXT_TOO_LARGE',
  CHAT_ATTACHMENT_NOT_FOUND: 'CHAT_ATTACHMENT_NOT_FOUND',
  CHAT_ATTACHMENT_TOO_LARGE: 'CHAT_ATTACHMENT_TOO_LARGE',
  CHAT_ATTACHMENT_TYPE_UNSUPPORTED: 'CHAT_ATTACHMENT_TYPE_UNSUPPORTED',
  CHAT_ATTACHMENT_PARSE_FAILED: 'CHAT_ATTACHMENT_PARSE_FAILED',
  CHAT_IMAGE_INVALID: 'CHAT_IMAGE_INVALID',
  CHAT_IMAGE_TOO_LARGE: 'CHAT_IMAGE_TOO_LARGE',
  CHAT_IMAGE_DIMENSIONS_UNSAFE: 'CHAT_IMAGE_DIMENSIONS_UNSAFE',
  CHAT_IMAGE_UNSUPPORTED: 'CHAT_IMAGE_UNSUPPORTED',
  CHAT_PDF_ENCRYPTED: 'CHAT_PDF_ENCRYPTED',
  CHAT_PDF_TEXT_UNAVAILABLE: 'CHAT_PDF_TEXT_UNAVAILABLE',
  CHAT_UNAUTHORIZED: 'CHAT_UNAUTHORIZED',
  CHAT_INVALID_REQUEST: 'CHAT_INVALID_REQUEST',
  CHAT_PROVIDER_AUTH: 'CHAT_PROVIDER_AUTH',
  CHAT_PROVIDER_REQUEST_FAILED: 'CHAT_PROVIDER_REQUEST_FAILED',
  CHAT_PROVIDER_TIMEOUT: 'CHAT_PROVIDER_TIMEOUT',
  CHAT_NETWORK_ERROR: 'CHAT_NETWORK_ERROR',
  CHAT_UNKNOWN_ERROR: 'CHAT_UNKNOWN_ERROR',
} as const;

export type ChatErrorCode =
  (typeof CHAT_ERROR_CODES)[keyof typeof CHAT_ERROR_CODES];

export class ChatError extends Error {
  constructor(
    public readonly code: ChatErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ChatError';
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
  if (error instanceof SummaryError) {
    return mapProviderError(error);
  }
  return {
    code: CHAT_ERROR_CODES.CHAT_UNKNOWN_ERROR,
    message: 'Unable to complete the Article Chat request.',
    retryable: false,
  };
}

function mapProviderError(error: SummaryError): ShaleError {
  const mapping = {
    SUMMARY_PROVIDER_AUTH: CHAT_ERROR_CODES.CHAT_PROVIDER_AUTH,
    SUMMARY_PROVIDER_REQUEST_FAILED: CHAT_ERROR_CODES.CHAT_PROVIDER_REQUEST_FAILED,
    SUMMARY_PROVIDER_TIMEOUT: CHAT_ERROR_CODES.CHAT_PROVIDER_TIMEOUT,
    SUMMARY_NETWORK_ERROR: CHAT_ERROR_CODES.CHAT_NETWORK_ERROR,
    SUMMARY_INTERRUPTED: CHAT_ERROR_CODES.CHAT_INTERRUPTED,
  } as const;
  const code = mapping[error.code as keyof typeof mapping];
  return code
    ? { code, message: error.message, retryable: error.retryable }
    : {
        code: CHAT_ERROR_CODES.CHAT_UNKNOWN_ERROR,
        message: 'Unable to complete the Article Chat request.',
        retryable: error.retryable,
      };
}
