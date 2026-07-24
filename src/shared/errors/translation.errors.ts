import type { ShaleError } from '../contracts/feed.ipc';
import { SummaryError } from './summary.errors';

export const TRANSLATION_ERROR_CODES = {
  TRANSLATION_INVALID_REQUEST: 'TRANSLATION_INVALID_REQUEST',
  TRANSLATION_CONTENT_UNAVAILABLE: 'TRANSLATION_CONTENT_UNAVAILABLE',
  TRANSLATION_PROVIDER_NOT_CONFIGURED: 'TRANSLATION_PROVIDER_NOT_CONFIGURED',
  TRANSLATION_BUSY: 'TRANSLATION_BUSY',
  TRANSLATION_INTERRUPTED: 'TRANSLATION_INTERRUPTED',
  TRANSLATION_EMPTY_OUTPUT: 'TRANSLATION_EMPTY_OUTPUT',
  TRANSLATION_INVALID_STRUCTURE: 'TRANSLATION_INVALID_STRUCTURE',
  TRANSLATION_PROVIDER_AUTH: 'TRANSLATION_PROVIDER_AUTH',
  TRANSLATION_PROVIDER_REQUEST_FAILED: 'TRANSLATION_PROVIDER_REQUEST_FAILED',
  TRANSLATION_PROVIDER_TIMEOUT: 'TRANSLATION_PROVIDER_TIMEOUT',
  TRANSLATION_NETWORK_ERROR: 'TRANSLATION_NETWORK_ERROR',
  TRANSLATION_CONTEXT_UNAVAILABLE: 'TRANSLATION_CONTEXT_UNAVAILABLE',
  TRANSLATION_TERMINOLOGY_UNAVAILABLE: 'TRANSLATION_TERMINOLOGY_UNAVAILABLE',
  TRANSLATION_TERMINOLOGY_INVALID: 'TRANSLATION_TERMINOLOGY_INVALID',
  TRANSLATION_UNKNOWN_ERROR: 'TRANSLATION_UNKNOWN_ERROR',
} as const;

export type TranslationErrorCode =
  (typeof TRANSLATION_ERROR_CODES)[keyof typeof TRANSLATION_ERROR_CODES];

export class TranslationError extends Error {
  constructor(
    public readonly code: TranslationErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}

export function toTranslationIpcError(error: unknown): ShaleError {
  if (error instanceof TranslationError) {
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
    code: TRANSLATION_ERROR_CODES.TRANSLATION_UNKNOWN_ERROR,
    message: 'Unable to complete the Translation request.',
    retryable: false,
  };
}

function mapProviderError(error: SummaryError): ShaleError {
  const mapping = {
    SUMMARY_PROVIDER_AUTH: {
      code: TRANSLATION_ERROR_CODES.TRANSLATION_PROVIDER_AUTH,
      message: 'The provider rejected the configured API key.',
    },
    SUMMARY_PROVIDER_REQUEST_FAILED: {
      code: TRANSLATION_ERROR_CODES.TRANSLATION_PROVIDER_REQUEST_FAILED,
      message: 'The provider could not complete the Translation request.',
    },
    SUMMARY_PROVIDER_TIMEOUT: {
      code: TRANSLATION_ERROR_CODES.TRANSLATION_PROVIDER_TIMEOUT,
      message: 'The provider did not respond before Translation timed out.',
    },
    SUMMARY_NETWORK_ERROR: {
      code: TRANSLATION_ERROR_CODES.TRANSLATION_NETWORK_ERROR,
      message: 'Unable to reach the configured provider for Translation.',
    },
    SUMMARY_INTERRUPTED: {
      code: TRANSLATION_ERROR_CODES.TRANSLATION_INTERRUPTED,
      message: 'Translation generation was interrupted before completion.',
    },
  } as const;
  const mapped = mapping[error.code as keyof typeof mapping];
  return mapped
    ? { ...mapped, retryable: error.retryable }
    : {
        code: TRANSLATION_ERROR_CODES.TRANSLATION_UNKNOWN_ERROR,
        message: 'Unable to complete the Translation request.',
        retryable: error.retryable,
      };
}
