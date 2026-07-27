import { performance } from 'node:perf_hooks';
import {
  ANNOTATION_ERROR_CODES,
  AnnotationError,
} from '../../shared/errors/annotation.errors';

export const ANNOTATION_LOG_EVENTS = {
  operationFailed: 'annotation.operation.failed',
} as const;

export const ANNOTATION_LOG_COMPONENTS = {
  operation: 'annotation.operation',
} as const;

export const ANNOTATION_OPERATIONS = [
  'load',
  'create',
  'update',
  'delete',
] as const;

export const ANNOTATION_OPERATION_STAGES = [
  'lookup',
  'read',
  'persist',
] as const;

export const ANNOTATION_OPERATION_ERROR_CODES = {
  lookupFailed: 'ANNOTATION_LOOKUP_FAILED',
  readFailed: 'ANNOTATION_READ_FAILED',
  persistFailed: 'ANNOTATION_PERSIST_FAILED',
} as const;

export type AnnotationOperation = (typeof ANNOTATION_OPERATIONS)[number];
export type AnnotationOperationStage = (
  typeof ANNOTATION_OPERATION_STAGES
)[number];
export type AnnotationOperationErrorCode = (
  typeof ANNOTATION_OPERATION_ERROR_CODES
)[keyof typeof ANNOTATION_OPERATION_ERROR_CODES]
  | typeof ANNOTATION_ERROR_CODES.ENTRY_NOT_FOUND
  | typeof ANNOTATION_ERROR_CODES.NOT_FOUND;

export interface AnnotationFailureLogContext {
  operation: AnnotationOperation;
  stage: AnnotationOperationStage;
  errorCode: AnnotationOperationErrorCode;
  durationMs: number;
  success: false;
  entryId?: number;
}

export interface AnnotationOperationLogger {
  error(
    event: typeof ANNOTATION_LOG_EVENTS.operationFailed,
    component: typeof ANNOTATION_LOG_COMPONENTS.operation,
    context: AnnotationFailureLogContext,
  ): void;
}

interface AnnotationFailureMetadata {
  operation: AnnotationOperation;
  stage: AnnotationOperationStage;
  errorCode: AnnotationOperationErrorCode;
}

const failureMetadata = new WeakMap<object, AnnotationFailureMetadata>();

export function rememberAnnotationOperationFailure(
  error: unknown,
  operation: AnnotationOperation,
  stage: AnnotationOperationStage,
): void {
  if (error instanceof AnnotationError || !isObject(error)) return;
  failureMetadata.set(error, {
    operation,
    stage,
    errorCode: getErrorCodeForStage(stage),
  });
}

export function getAnnotationOperationFailure(
  error: unknown,
  operation: AnnotationOperation,
): Omit<AnnotationFailureLogContext, 'durationMs' | 'success' | 'entryId'> | undefined {
  if (error instanceof AnnotationError) {
    if (
      error.code === ANNOTATION_ERROR_CODES.ENTRY_NOT_FOUND
      || error.code === ANNOTATION_ERROR_CODES.NOT_FOUND
    ) {
      return {
        operation,
        stage: 'lookup',
        errorCode: error.code,
      };
    }
    return undefined;
  }

  const metadata = isObject(error) ? failureMetadata.get(error) : undefined;
  return metadata?.operation === operation ? metadata : undefined;
}

export function logAnnotationOperationFailure(
  logger: AnnotationOperationLogger | undefined,
  context: AnnotationFailureLogContext,
): void {
  if (
    !ANNOTATION_OPERATIONS.includes(context.operation)
    || !isAllowedFailure(context.stage, context.errorCode)
    || !isSafeDuration(context.durationMs)
    || context.success !== false
    || (context.entryId !== undefined && !isSafeIdentifier(context.entryId))
  ) {
    return;
  }

  try {
    logger?.error(
      ANNOTATION_LOG_EVENTS.operationFailed,
      ANNOTATION_LOG_COMPONENTS.operation,
      {
        operation: context.operation,
        stage: context.stage,
        errorCode: context.errorCode,
        durationMs: context.durationMs,
        success: false,
        ...(context.entryId === undefined ? {} : { entryId: context.entryId }),
      },
    );
  } catch {
    // Diagnostics must not alter the annotation operation result.
  }
}

export function elapsedAnnotationMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function isAllowedFailure(
  stage: AnnotationOperationStage,
  errorCode: AnnotationOperationErrorCode,
): boolean {
  switch (stage) {
    case 'lookup':
      return errorCode === ANNOTATION_OPERATION_ERROR_CODES.lookupFailed
        || errorCode === ANNOTATION_ERROR_CODES.ENTRY_NOT_FOUND
        || errorCode === ANNOTATION_ERROR_CODES.NOT_FOUND;
    case 'read':
      return errorCode === ANNOTATION_OPERATION_ERROR_CODES.readFailed;
    case 'persist':
      return errorCode === ANNOTATION_OPERATION_ERROR_CODES.persistFailed;
  }
}

function getErrorCodeForStage(
  stage: AnnotationOperationStage,
): AnnotationOperationErrorCode {
  switch (stage) {
    case 'lookup':
      return ANNOTATION_OPERATION_ERROR_CODES.lookupFailed;
    case 'read':
      return ANNOTATION_OPERATION_ERROR_CODES.readFailed;
    case 'persist':
      return ANNOTATION_OPERATION_ERROR_CODES.persistFailed;
  }
}

function isSafeIdentifier(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isSafeDuration(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isObject(value: unknown): value is object {
  return Boolean(value && typeof value === 'object');
}
