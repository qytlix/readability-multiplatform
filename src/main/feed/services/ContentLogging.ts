import { performance } from 'node:perf_hooks';

export const CONTENT_LOG_EVENTS = {
  pipelineCompleted: 'content.pipeline.completed',
  pipelineFailed: 'content.pipeline.failed',
} as const;

export const CONTENT_LOG_COMPONENTS = {
  pipeline: 'content.pipeline',
} as const;

export const CONTENT_PIPELINE_STAGES = [
  'lookup',
  'validate',
  'fetch',
  'clean',
  'convert',
  'persist',
] as const;

export const CONTENT_PIPELINE_ERROR_CODES = {
  lookupFailed: 'CONTENT_LOOKUP_FAILED',
  entryNotFound: 'CONTENT_ENTRY_NOT_FOUND',
  entryUrlMissing: 'CONTENT_ENTRY_URL_MISSING',
  fetchFailed: 'CONTENT_FETCH_FAILED',
  cleanFailed: 'CONTENT_CLEAN_FAILED',
  convertFailed: 'CONTENT_CONVERT_FAILED',
  persistFailed: 'CONTENT_PERSIST_FAILED',
} as const;

export type ContentPipelineStage = (typeof CONTENT_PIPELINE_STAGES)[number];
export type ContentPipelineErrorCode = (
  typeof CONTENT_PIPELINE_ERROR_CODES
)[keyof typeof CONTENT_PIPELINE_ERROR_CODES];

const CONTENT_PIPELINE_ERROR_CODES_BY_STAGE = {
  lookup: [
    CONTENT_PIPELINE_ERROR_CODES.lookupFailed,
    CONTENT_PIPELINE_ERROR_CODES.entryNotFound,
  ],
  validate: [CONTENT_PIPELINE_ERROR_CODES.entryUrlMissing],
  fetch: [CONTENT_PIPELINE_ERROR_CODES.fetchFailed],
  clean: [CONTENT_PIPELINE_ERROR_CODES.cleanFailed],
  convert: [CONTENT_PIPELINE_ERROR_CODES.convertFailed],
  persist: [CONTENT_PIPELINE_ERROR_CODES.persistFailed],
} as const satisfies Record<
  ContentPipelineStage,
  readonly ContentPipelineErrorCode[]
>;

export interface ContentLogContext {
  entryId: number;
  feedId?: number;
  durationMs: number;
  success: false;
  stage: ContentPipelineStage;
  errorCode: ContentPipelineErrorCode;
}

/** The limited logging surface required by the Content pipeline. */
export interface ContentOperationLogger {
  info?(
    event: typeof CONTENT_LOG_EVENTS.pipelineCompleted,
    component: typeof CONTENT_LOG_COMPONENTS.pipeline,
    context: ContentSuccessLogContext,
  ): void;
  error(
    event: typeof CONTENT_LOG_EVENTS.pipelineFailed,
    component: typeof CONTENT_LOG_COMPONENTS.pipeline,
    context: ContentLogContext,
  ): void;
}

export interface ContentSuccessLogContext {
  entryId: number;
  feedId?: number;
  durationMs: number;
  fetchDurationMs: number;
  cleanDurationMs: number;
  convertDurationMs: number;
  persistDurationMs: number;
  attemptCount?: number;
  strategy?: string;
  success: true;
}

export function logContentPipelineSuccess(
  logger: ContentOperationLogger | undefined,
  context: ContentSuccessLogContext,
): void {
  if (
    !isSafeIdentifier(context.entryId)
    || (context.feedId !== undefined && !isSafeIdentifier(context.feedId))
    || !isSafeDuration(context.durationMs)
    || !isSafeDuration(context.fetchDurationMs)
    || !isSafeDuration(context.cleanDurationMs)
    || !isSafeDuration(context.convertDurationMs)
    || !isSafeDuration(context.persistDurationMs)
    || (
      context.attemptCount !== undefined
      && !isSafeDuration(context.attemptCount)
    )
    || (
      context.strategy !== undefined
      && !/^[a-z][a-z0-9-]*$/.test(context.strategy)
    )
    || context.success !== true
  ) {
    return;
  }

  try {
    logger?.info?.(
      CONTENT_LOG_EVENTS.pipelineCompleted,
      CONTENT_LOG_COMPONENTS.pipeline,
      context,
    );
  } catch {
    // Preserve the existing Content return and persistence behavior.
  }
}

export function elapsedContentMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

/** Logging is observational and must not change Content operation behavior. */
export function logContentPipelineFailure(
  logger: ContentOperationLogger | undefined,
  context: ContentLogContext,
): void {
  if (
    !isSafeIdentifier(context.entryId)
    || (context.feedId !== undefined && !isSafeIdentifier(context.feedId))
    || !isSafeDuration(context.durationMs)
    || context.success !== false
    || !isAllowedContentPipelineFailure(context.stage, context.errorCode)
  ) {
    return;
  }

  try {
    logger?.error(
      CONTENT_LOG_EVENTS.pipelineFailed,
      CONTENT_LOG_COMPONENTS.pipeline,
      {
        entryId: context.entryId,
        ...(context.feedId === undefined ? {} : { feedId: context.feedId }),
        durationMs: context.durationMs,
        success: false,
        stage: context.stage,
        errorCode: context.errorCode,
      },
    );
  } catch {
    // Preserve the existing Content return, persistence, and error behavior.
  }
}

function isAllowedContentPipelineFailure(
  stage: unknown,
  errorCode: unknown,
): stage is ContentPipelineStage {
  if (!CONTENT_PIPELINE_STAGES.includes(stage as ContentPipelineStage)) {
    return false;
  }

  const contentStage = stage as ContentPipelineStage;
  return CONTENT_PIPELINE_ERROR_CODES_BY_STAGE[contentStage].includes(
    errorCode as never,
  );
}

function isSafeIdentifier(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isSafeDuration(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
