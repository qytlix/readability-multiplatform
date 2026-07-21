import { performance } from 'node:perf_hooks';

export const OPML_LOG_EVENTS = {
  importCompleted: 'opml.import.completed',
  importFailed: 'opml.import.failed',
  exportCompleted: 'opml.export.completed',
  exportFailed: 'opml.export.failed',
  exportTempCleanupFailed: 'opml.export.temp.cleanup.failed',
} as const;

export const OPML_LOG_COMPONENTS = {
  import: 'opml.import',
  export: 'opml.export',
} as const;

export const OPML_IMPORT_STAGES = ['read', 'parse', 'process'] as const;
export const OPML_EXPORT_STAGES = [
  'serialize',
  'write',
  'rename',
  'cleanup',
] as const;

export const OPML_LOG_ERROR_CODES = {
  importReadFailed: 'OPML_IMPORT_READ_FAILED',
  importInvalid: 'OPML_IMPORT_INVALID',
  importParseFailed: 'OPML_IMPORT_PARSE_FAILED',
  importProcessFailed: 'OPML_IMPORT_PROCESS_FAILED',
  exportSerializeFailed: 'OPML_EXPORT_SERIALIZE_FAILED',
  exportWriteFailed: 'OPML_EXPORT_WRITE_FAILED',
  exportRenameFailed: 'OPML_EXPORT_RENAME_FAILED',
  exportTempCleanupFailed: 'OPML_EXPORT_TEMP_CLEANUP_FAILED',
} as const;

export type OPMLImportStage = (typeof OPML_IMPORT_STAGES)[number];
export type OPMLExportStage = (typeof OPML_EXPORT_STAGES)[number];
export type OPMLErrorCode = (
  typeof OPML_LOG_ERROR_CODES
)[keyof typeof OPML_LOG_ERROR_CODES];

export interface OPMLImportCompletedLogContext {
  durationMs: number;
  count: number;
  successCount: number;
  failureCount: number;
}

export interface OPMLImportFailedLogContext {
  durationMs: number;
  stage: OPMLImportStage;
  errorCode: OPMLErrorCode;
}

export interface OPMLExportCompletedLogContext {
  durationMs: number;
  count: number;
}

export interface OPMLExportFailedLogContext {
  durationMs: number;
  stage: OPMLExportStage;
  errorCode: OPMLErrorCode;
  count?: number;
}

export interface OPMLExportTempCleanupFailedLogContext {
  durationMs: number;
  stage: 'cleanup';
  errorCode: typeof OPML_LOG_ERROR_CODES.exportTempCleanupFailed;
}

const OPML_IMPORT_ERROR_CODES_BY_STAGE = {
  read: [OPML_LOG_ERROR_CODES.importReadFailed],
  parse: [
    OPML_LOG_ERROR_CODES.importInvalid,
    OPML_LOG_ERROR_CODES.importParseFailed,
  ],
  process: [OPML_LOG_ERROR_CODES.importProcessFailed],
} as const satisfies Record<OPMLImportStage, readonly OPMLErrorCode[]>;

const OPML_EXPORT_ERROR_CODES_BY_STAGE = {
  serialize: [OPML_LOG_ERROR_CODES.exportSerializeFailed],
  write: [OPML_LOG_ERROR_CODES.exportWriteFailed],
  rename: [OPML_LOG_ERROR_CODES.exportRenameFailed],
  cleanup: [OPML_LOG_ERROR_CODES.exportTempCleanupFailed],
} as const satisfies Record<OPMLExportStage, readonly OPMLErrorCode[]>;

/** The limited logging surface required by OPML import and export. */
export interface OPMLOperationLogger {
  info(
    event:
      | typeof OPML_LOG_EVENTS.importCompleted
      | typeof OPML_LOG_EVENTS.exportCompleted,
    component:
      | typeof OPML_LOG_COMPONENTS.import
      | typeof OPML_LOG_COMPONENTS.export,
    context: OPMLImportCompletedLogContext | OPMLExportCompletedLogContext,
  ): void;
  warn(
    event: typeof OPML_LOG_EVENTS.exportTempCleanupFailed,
    component: typeof OPML_LOG_COMPONENTS.export,
    context: OPMLExportTempCleanupFailedLogContext,
  ): void;
  error(
    event:
      | typeof OPML_LOG_EVENTS.importFailed
      | typeof OPML_LOG_EVENTS.exportFailed,
    component:
      | typeof OPML_LOG_COMPONENTS.import
      | typeof OPML_LOG_COMPONENTS.export,
    context: OPMLImportFailedLogContext | OPMLExportFailedLogContext,
  ): void;
}

export function elapsedOPMLMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export function logOPMLImportCompleted(
  logger: OPMLOperationLogger | undefined,
  context: OPMLImportCompletedLogContext,
): void {
  if (!isImportCompletedContext(context)) return;

  try {
    logger?.info(OPML_LOG_EVENTS.importCompleted, OPML_LOG_COMPONENTS.import, {
      durationMs: context.durationMs,
      count: context.count,
      successCount: context.successCount,
      failureCount: context.failureCount,
    });
  } catch {
    // Logging is observational and must not change OPML operation behavior.
  }
}

export function logOPMLImportFailed(
  logger: OPMLOperationLogger | undefined,
  context: OPMLImportFailedLogContext,
): void {
  if (
    !isSafeDuration(context.durationMs)
    || !isAllowedImportFailure(context.stage, context.errorCode)
  ) {
    return;
  }

  try {
    logger?.error(OPML_LOG_EVENTS.importFailed, OPML_LOG_COMPONENTS.import, {
      durationMs: context.durationMs,
      stage: context.stage,
      errorCode: context.errorCode,
    });
  } catch {
    // Logging is observational and must not change OPML operation behavior.
  }
}

export function logOPMLExportCompleted(
  logger: OPMLOperationLogger | undefined,
  context: OPMLExportCompletedLogContext,
): void {
  if (!isExportCompletedContext(context)) return;

  try {
    logger?.info(OPML_LOG_EVENTS.exportCompleted, OPML_LOG_COMPONENTS.export, {
      durationMs: context.durationMs,
      count: context.count,
    });
  } catch {
    // Logging is observational and must not change OPML operation behavior.
  }
}

export function logOPMLExportFailed(
  logger: OPMLOperationLogger | undefined,
  context: OPMLExportFailedLogContext,
): void {
  if (
    !isSafeDuration(context.durationMs)
    || !isAllowedExportFailure(context.stage, context.errorCode)
    || (context.count !== undefined && !isSafeCount(context.count))
  ) {
    return;
  }

  try {
    logger?.error(OPML_LOG_EVENTS.exportFailed, OPML_LOG_COMPONENTS.export, {
      durationMs: context.durationMs,
      stage: context.stage,
      errorCode: context.errorCode,
      ...(context.count === undefined ? {} : { count: context.count }),
    });
  } catch {
    // Logging is observational and must not change OPML operation behavior.
  }
}

export function logOPMLExportTempCleanupFailed(
  logger: OPMLOperationLogger | undefined,
  context: OPMLExportTempCleanupFailedLogContext,
): void {
  if (
    context.stage !== 'cleanup'
    || context.errorCode !== OPML_LOG_ERROR_CODES.exportTempCleanupFailed
    || !isSafeDuration(context.durationMs)
  ) {
    return;
  }

  try {
    logger?.warn(
      OPML_LOG_EVENTS.exportTempCleanupFailed,
      OPML_LOG_COMPONENTS.export,
      {
        durationMs: context.durationMs,
        stage: context.stage,
        errorCode: context.errorCode,
      },
    );
  } catch {
    // Logging is observational and must not change OPML operation behavior.
  }
}

function isImportCompletedContext(
  context: OPMLImportCompletedLogContext,
): boolean {
  return isSafeDuration(context.durationMs)
    && isSafeCount(context.count)
    && isSafeCount(context.successCount)
    && isSafeCount(context.failureCount);
}

function isExportCompletedContext(
  context: OPMLExportCompletedLogContext,
): boolean {
  return isSafeDuration(context.durationMs) && isSafeCount(context.count);
}

function isAllowedImportFailure(
  stage: unknown,
  errorCode: unknown,
): stage is OPMLImportStage {
  if (!OPML_IMPORT_STAGES.includes(stage as OPMLImportStage)) return false;

  return OPML_IMPORT_ERROR_CODES_BY_STAGE[stage as OPMLImportStage].includes(
    errorCode as never,
  );
}

function isAllowedExportFailure(
  stage: unknown,
  errorCode: unknown,
): stage is OPMLExportStage {
  if (!OPML_EXPORT_STAGES.includes(stage as OPMLExportStage)) return false;

  return OPML_EXPORT_ERROR_CODES_BY_STAGE[stage as OPMLExportStage].includes(
    errorCode as never,
  );
}

function isSafeDuration(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isSafeCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
