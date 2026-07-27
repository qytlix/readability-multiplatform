import type { ShaleError } from '../../../shared/contracts/feed.ipc';

export const TAG_ERROR_CODES = {
  INVALID_REQUEST: 'TAG_INVALID_REQUEST',
  ENTRY_NOT_FOUND: 'TAG_ENTRY_NOT_FOUND',
  TAG_NOT_FOUND: 'TAG_NOT_FOUND',
  UNKNOWN: 'TAG_UNKNOWN_ERROR',
} as const;

export type TagErrorCode =
  (typeof TAG_ERROR_CODES)[keyof typeof TAG_ERROR_CODES];

export class TagError extends Error {
  constructor(
    public readonly code: TagErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'TagError';
  }
}

export function toTagIpcError(error: unknown): ShaleError {
  if (error instanceof TagError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  return {
    code: TAG_ERROR_CODES.UNKNOWN,
    message: 'Unable to complete the tag request.',
    retryable: false,
  };
}