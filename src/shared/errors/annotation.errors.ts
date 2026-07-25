import type { ShaleError } from '../contracts/feed.ipc';

export const ANNOTATION_ERROR_CODES = {
  INVALID_REQUEST: 'ANNOTATION_INVALID_REQUEST',
  ENTRY_NOT_FOUND: 'ANNOTATION_ENTRY_NOT_FOUND',
  NOT_FOUND: 'ANNOTATION_NOT_FOUND',
  OVERLAP: 'ANNOTATION_OVERLAP',
  UNKNOWN: 'ANNOTATION_UNKNOWN_ERROR',
} as const;

export type AnnotationErrorCode =
  (typeof ANNOTATION_ERROR_CODES)[keyof typeof ANNOTATION_ERROR_CODES];

export class AnnotationError extends Error {
  constructor(
    public readonly code: AnnotationErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'AnnotationError';
  }
}

export function toAnnotationIpcError(error: unknown): ShaleError {
  if (error instanceof AnnotationError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  return {
    code: ANNOTATION_ERROR_CODES.UNKNOWN,
    message: 'Unable to complete the annotation request.',
    retryable: false,
  };
}
