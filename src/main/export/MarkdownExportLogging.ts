import { performance } from 'node:perf_hooks';

export const MARKDOWN_EXPORT_LOG_EVENTS = {
  completed: 'markdown.export.completed',
  failed: 'markdown.export.failed',
} as const;

export const MARKDOWN_EXPORT_LOG_COMPONENT = 'markdown.export';

export const MARKDOWN_EXPORT_STAGES = [
  'validate',
  'prepare',
  'serialize',
  'dialog',
  'write',
] as const;

export const MARKDOWN_EXPORT_LOG_ERROR_CODES = {
  validationFailed: 'MARKDOWN_EXPORT_VALIDATION_FAILED',
  prepareFailed: 'MARKDOWN_EXPORT_PREPARE_FAILED',
  serializeFailed: 'MARKDOWN_EXPORT_SERIALIZE_FAILED',
  dialogFailed: 'MARKDOWN_EXPORT_DIALOG_FAILED',
  writeFailed: 'MARKDOWN_EXPORT_WRITE_FAILED',
} as const;

export type MarkdownExportStage = (typeof MARKDOWN_EXPORT_STAGES)[number];
export type MarkdownExportLogErrorCode = (
  typeof MARKDOWN_EXPORT_LOG_ERROR_CODES
)[keyof typeof MARKDOWN_EXPORT_LOG_ERROR_CODES];

export interface MarkdownExportCompletedLogContext {
  durationMs: number;
  count: number;
  downloadedImageCount?: number;
  failedImageCount?: number;
}

export interface MarkdownExportFailedLogContext {
  durationMs: number;
  stage: MarkdownExportStage;
  errorCode: MarkdownExportLogErrorCode;
  count?: number;
}

/** The limited logging surface required by one Markdown export operation. */
export interface MarkdownExportOperationLogger {
  info(
    event: typeof MARKDOWN_EXPORT_LOG_EVENTS.completed,
    component: typeof MARKDOWN_EXPORT_LOG_COMPONENT,
    context: MarkdownExportCompletedLogContext,
  ): void;
  error(
    event: typeof MARKDOWN_EXPORT_LOG_EVENTS.failed,
    component: typeof MARKDOWN_EXPORT_LOG_COMPONENT,
    context: MarkdownExportFailedLogContext,
  ): void;
}

const MARKDOWN_EXPORT_ERROR_CODES_BY_STAGE = {
  validate: MARKDOWN_EXPORT_LOG_ERROR_CODES.validationFailed,
  prepare: MARKDOWN_EXPORT_LOG_ERROR_CODES.prepareFailed,
  serialize: MARKDOWN_EXPORT_LOG_ERROR_CODES.serializeFailed,
  dialog: MARKDOWN_EXPORT_LOG_ERROR_CODES.dialogFailed,
  write: MARKDOWN_EXPORT_LOG_ERROR_CODES.writeFailed,
} as const satisfies Record<MarkdownExportStage, MarkdownExportLogErrorCode>;

export function elapsedMarkdownExportMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export function getMarkdownExportErrorCode(
  stage: MarkdownExportStage,
): MarkdownExportLogErrorCode {
  return MARKDOWN_EXPORT_ERROR_CODES_BY_STAGE[stage];
}

export function logMarkdownExportCompleted(
  logger: MarkdownExportOperationLogger | undefined,
  context: MarkdownExportCompletedLogContext,
): void {
  if (
    !isSafeDuration(context.durationMs)
    || !isSafeCount(context.count)
    || !isValidImageLocalizationCounts(context)
  ) return;

  try {
    logger?.info(MARKDOWN_EXPORT_LOG_EVENTS.completed, MARKDOWN_EXPORT_LOG_COMPONENT, {
      durationMs: context.durationMs,
      count: context.count,
      ...(context.downloadedImageCount === undefined
        ? {}
        : { downloadedImageCount: context.downloadedImageCount }),
      ...(context.failedImageCount === undefined
        ? {}
        : { failedImageCount: context.failedImageCount }),
    });
  } catch {
    // Logging is observational and must not change export behavior.
  }
}

export function logMarkdownExportFailed(
  logger: MarkdownExportOperationLogger | undefined,
  context: MarkdownExportFailedLogContext,
): void {
  if (
    !isSafeDuration(context.durationMs)
    || !MARKDOWN_EXPORT_STAGES.includes(context.stage)
    || getMarkdownExportErrorCode(context.stage) !== context.errorCode
    || (context.count !== undefined && !isSafeCount(context.count))
  ) {
    return;
  }

  try {
    logger?.error(MARKDOWN_EXPORT_LOG_EVENTS.failed, MARKDOWN_EXPORT_LOG_COMPONENT, {
      durationMs: context.durationMs,
      stage: context.stage,
      errorCode: context.errorCode,
      ...(context.count === undefined ? {} : { count: context.count }),
    });
  } catch {
    // Logging is observational and must not change export behavior.
  }
}

function isSafeDuration(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isSafeCount(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isValidImageLocalizationCounts(
  context: MarkdownExportCompletedLogContext,
): boolean {
  return (context.downloadedImageCount === undefined && context.failedImageCount === undefined)
    || (
      isSafeNonNegativeCount(context.downloadedImageCount)
      && isSafeNonNegativeCount(context.failedImageCount)
    );
}

function isSafeNonNegativeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
