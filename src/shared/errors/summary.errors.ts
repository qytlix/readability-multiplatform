import type { ShaleError } from '../contracts/feed.ipc';

export const SUMMARY_ERROR_CODES = {
  SUMMARY_INVALID_REQUEST: 'SUMMARY_INVALID_REQUEST',
  SUMMARY_CONTENT_UNAVAILABLE: 'SUMMARY_CONTENT_UNAVAILABLE',
  SUMMARY_PROVIDER_NOT_CONFIGURED: 'SUMMARY_PROVIDER_NOT_CONFIGURED',
  SUMMARY_KEY_STORAGE_UNAVAILABLE: 'SUMMARY_KEY_STORAGE_UNAVAILABLE',
  SUMMARY_KEY_MISSING: 'SUMMARY_KEY_MISSING',
  SUMMARY_BUSY: 'SUMMARY_BUSY',
  SUMMARY_INTERRUPTED: 'SUMMARY_INTERRUPTED',
  SUMMARY_PROVIDER_AUTH: 'SUMMARY_PROVIDER_AUTH',
  SUMMARY_PROVIDER_REQUEST_FAILED: 'SUMMARY_PROVIDER_REQUEST_FAILED',
  SUMMARY_PROVIDER_TIMEOUT: 'SUMMARY_PROVIDER_TIMEOUT',
  SUMMARY_EMPTY_OUTPUT: 'SUMMARY_EMPTY_OUTPUT',
  SUMMARY_NETWORK_ERROR: 'SUMMARY_NETWORK_ERROR',
  SUMMARY_UNKNOWN_ERROR: 'SUMMARY_UNKNOWN_ERROR',
} as const;

export type SummaryErrorCode =
  (typeof SUMMARY_ERROR_CODES)[keyof typeof SUMMARY_ERROR_CODES];

export class SummaryError extends Error {
  constructor(
    public readonly code: SummaryErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'SummaryError';
  }
}

export function toSummaryIpcError(error: unknown): ShaleError {
  if (error instanceof SummaryError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  return {
    code: SUMMARY_ERROR_CODES.SUMMARY_UNKNOWN_ERROR,
    message: 'Unable to complete the Summary request.',
    retryable: false,
  };
}
