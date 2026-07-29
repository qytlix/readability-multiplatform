import { performance } from 'node:perf_hooks';
import type { ProviderTokenUsage } from '../provider/SummaryProvider';
import type { TranslationResultVariant } from '../../../shared/contracts/translation.types';
import type { ProviderFinishReason } from '../provider/TextGenerationProvider';
import {
  TRANSLATION_COMPENSATION_PROTOCOLS,
  type TranslationCompensationProtocol,
} from '../provider/TranslationTextSlotCompensation';
import {
  TRANSLATION_HTML_VALIDATION_REASONS,
  TRANSLATION_OUTPUT_FAILURE_PHASES,
  TRANSLATION_OUTPUT_REASON_CODES,
  type TranslationHtmlValidationReason,
  type TranslationOutputFailurePhase,
  type TranslationOutputReasonCode,
} from '../TranslationOutputDiagnostics';

export const TRANSLATION_LOG_EVENTS = {
  runStarted: 'translation.run.started',
  runCompleted: 'translation.run.completed',
  runFailed: 'translation.run.failed',
  runInterrupted: 'translation.run.interrupted',
  recoveryCompleted: 'translation.recovery.completed',
  providerRequestFailed: 'translation.provider.request.failed',
  missingSegmentsDetected: 'translation.provider.omission.detected',
  inlineFailed: 'translation.inline.failed',
} as const;

export const TRANSLATION_LOG_COMPONENTS = {
  run: 'translation.run',
  recovery: 'translation.recovery',
  providerRequest: 'translation.provider.request',
  providerRecovery: 'translation.provider.recovery',
  inline: 'translation.inline',
} as const;

export const TRANSLATION_RUN_FAILURE_STAGES = ['stream', 'persist'] as const;
export const TRANSLATION_INLINE_FAILURE_STAGES = [
  'configuration',
  'provider',
  'parse',
] as const;
export const TRANSLATION_PROVIDER_REQUEST_KINDS = [
  'batch',
  'compensation',
  'deep-draft',
  'deep-review',
  'deep-rewrite',
  'deep-draft-compensation',
  'deep-rewrite-compensation',
] as const;
export const TRANSLATION_LOG_TRIGGERS = [
  'initial',
  'resume',
  'force-new',
  'startup-recovery',
] as const;
export const TRANSLATION_PREVIOUS_RESULT_OUTCOMES = ['none', 'retained', 'replaced'] as const;
export const TRANSLATION_PREVIOUS_RESULT_AT_START_VALUES = ['none', 'retained'] as const;
export const TRANSLATION_STOP_REASONS = ['paused', 'shutdown'] as const;
export const TRANSLATION_CONTEXT_WARNING_CODES = [
  'TRANSLATION_CONTEXT_UNAVAILABLE',
] as const;

export const TRANSLATION_LOG_ERROR_CODES = {
  emptyOutput: 'TRANSLATION_EMPTY_OUTPUT',
  invalidStructure: 'TRANSLATION_INVALID_STRUCTURE',
  providerAuth: 'TRANSLATION_PROVIDER_AUTH',
  providerRequestFailed: 'TRANSLATION_PROVIDER_REQUEST_FAILED',
  providerTimeout: 'TRANSLATION_PROVIDER_TIMEOUT',
  networkError: 'TRANSLATION_NETWORK_ERROR',
  unknownError: 'TRANSLATION_UNKNOWN_ERROR',
  interrupted: 'TRANSLATION_INTERRUPTED',
} as const;

export const TRANSLATION_INLINE_FAILURE_ERROR_CODES = {
  providerNotConfigured: 'TRANSLATION_PROVIDER_NOT_CONFIGURED',
  terminologyUnavailable: 'TRANSLATION_TERMINOLOGY_UNAVAILABLE',
  providerAuth: 'TRANSLATION_PROVIDER_AUTH',
  providerRequestFailed: 'TRANSLATION_PROVIDER_REQUEST_FAILED',
  providerTimeout: 'TRANSLATION_PROVIDER_TIMEOUT',
  networkError: 'TRANSLATION_NETWORK_ERROR',
  emptyOutput: 'TRANSLATION_EMPTY_OUTPUT',
  invalidStructure: 'TRANSLATION_INVALID_STRUCTURE',
  unknownError: 'TRANSLATION_UNKNOWN_ERROR',
} as const;

export type TranslationRunFailureStage = (typeof TRANSLATION_RUN_FAILURE_STAGES)[number];
export type TranslationInlineFailureStage = (typeof TRANSLATION_INLINE_FAILURE_STAGES)[number];
export type TranslationProviderRequestKind = (
  typeof TRANSLATION_PROVIDER_REQUEST_KINDS
)[number];
export type TranslationLogTrigger = (typeof TRANSLATION_LOG_TRIGGERS)[number];
export type TranslationPreviousResultOutcome = (
  typeof TRANSLATION_PREVIOUS_RESULT_OUTCOMES
)[number];
export type TranslationPreviousResultAtStart = (
  typeof TRANSLATION_PREVIOUS_RESULT_AT_START_VALUES
)[number];
export type TranslationStopReason = (typeof TRANSLATION_STOP_REASONS)[number];
export type TranslationContextWarningCode = (
  typeof TRANSLATION_CONTEXT_WARNING_CODES
)[number];
export type TranslationLogErrorCode = (
  typeof TRANSLATION_LOG_ERROR_CODES
)[keyof typeof TRANSLATION_LOG_ERROR_CODES];
export type TranslationInlineFailureErrorCode = (
  typeof TRANSLATION_INLINE_FAILURE_ERROR_CODES
)[keyof typeof TRANSLATION_INLINE_FAILURE_ERROR_CODES];

export interface TranslationRunStartedLogContext {
  taskRunId: number;
  trigger: TranslationLogTrigger;
  previousResultAtStart: TranslationPreviousResultAtStart;
  translationVariant?: TranslationResultVariant;
}

/** Aggregate counts for a Translation run; no segment identity or content is included. */
export interface TranslationRunDiagnosticSummary extends ProviderTokenUsage {
  providerRequestCount: number;
  batchRequestCount: number;
  compensationRequestCount: number;
  deepDraftRequestCount?: number;
  deepReviewRequestCount?: number;
  deepRewriteRequestCount?: number;
  providerRequestSuccessCount: number;
  providerRequestFailureCount: number;
  missingSegmentCount: number;
  unresolvedMissingSegmentCount: number;
}

export interface TranslationRunCompletedLogContext extends TranslationRunDiagnosticSummary {
  taskRunId: number;
  translationVariant?: TranslationResultVariant;
  trigger: TranslationLogTrigger;
  previousResultOutcome: TranslationPreviousResultOutcome;
  durationMs: number;
  success: true;
  contextDegraded?: true;
  contextWarningCode?: TranslationContextWarningCode;
}

export interface TranslationRunFailedLogContext extends TranslationRunDiagnosticSummary {
  taskRunId: number;
  translationVariant?: TranslationResultVariant;
  deepStage?: 'draft' | 'review' | 'rewrite';
  trigger: TranslationLogTrigger;
  previousResultOutcome: TranslationPreviousResultOutcome;
  durationMs: number;
  success: false;
  stage: TranslationRunFailureStage;
  errorCode: TranslationLogErrorCode;
  contextDegraded?: true;
  contextWarningCode?: TranslationContextWarningCode;
}

export interface TranslationRunInterruptedLogContext extends TranslationRunDiagnosticSummary {
  taskRunId: number;
  translationVariant?: TranslationResultVariant;
  trigger: TranslationLogTrigger;
  previousResultOutcome: TranslationPreviousResultOutcome;
  durationMs: number;
  success: false;
  stage: 'interrupt';
  errorCode: typeof TRANSLATION_LOG_ERROR_CODES.interrupted;
  stopReason: TranslationStopReason;
  contextDegraded?: true;
  contextWarningCode?: TranslationContextWarningCode;
}

export interface TranslationRecoveryCompletedLogContext {
  durationMs: number;
  count: number;
  trigger: 'startup-recovery';
}

/** Safe, aggregate-only response facts for a single provider request. */
export interface TranslationProviderResponseDiagnostics {
  failurePhase?: TranslationOutputFailurePhase;
  reasonCode?: TranslationOutputReasonCode;
  htmlValidationReason?: TranslationHtmlValidationReason;
  compensationProtocol?: TranslationCompensationProtocol;
  finishReason?: ProviderFinishReason;
  expectedSegmentCount?: number;
  parsedSegmentCount?: number;
  acceptedSegmentCount?: number;
  missingSegmentCount?: number;
  duplicateSegmentCount?: number;
  unexpectedSegmentCount?: number;
  malformedRecordCount?: number;
  emptyTranslationCount?: number;
  expectedTextSlotCount?: number;
  parsedTextSlotCount?: number;
  acceptedTextSlotCount?: number;
  missingTextSlotCount?: number;
  duplicateTextSlotCount?: number;
  unexpectedTextSlotCount?: number;
  malformedTextSlotCount?: number;
  emptyTextSlotCount?: number;
  inputCharacters?: number;
  outputCharacters?: number;
  affectedSegmentIdHashes?: string[];
}

/**
 * Flat fields that may cross the generic structured-log boundary. Keeping
 * these separate from `responseDiagnostics` prevents the logger from ever
 * accepting an arbitrary nested response object.
 */
export interface TranslationProviderResponseDiagnosticLogFields {
  reasonCode?: TranslationOutputReasonCode;
  validationStage?: TranslationOutputFailurePhase;
  htmlValidationReason?: TranslationHtmlValidationReason;
  compensationProtocol?: TranslationCompensationProtocol;
  finishReason?: ProviderFinishReason;
  expectedSegmentCount?: number;
  parsedSegmentCount?: number;
  acceptedSegmentCount?: number;
  missingSegmentCount?: number;
  duplicateSegmentCount?: number;
  unexpectedSegmentCount?: number;
  malformedRecordCount?: number;
  emptyTranslationCount?: number;
  expectedTextSlotCount?: number;
  parsedTextSlotCount?: number;
  acceptedTextSlotCount?: number;
  missingTextSlotCount?: number;
  duplicateTextSlotCount?: number;
  unexpectedTextSlotCount?: number;
  malformedTextSlotCount?: number;
  emptyTextSlotCount?: number;
  inputCharacters?: number;
  outputCharacters?: number;
  affectedSegmentIdHashes?: string[];
}

export interface TranslationProviderRequestFailedLogContext
  extends ProviderTokenUsage, TranslationProviderResponseDiagnosticLogFields {
  taskRunId: number;
  providerRequestId: number;
  requestKind: TranslationProviderRequestKind;
  segmentCount: number;
  durationMs: number;
  success: false;
  errorCode: TranslationLogErrorCode;
  responseDiagnostics?: TranslationProviderResponseDiagnostics;
}

export interface TranslationMissingSegmentsLogContext
  extends TranslationProviderResponseDiagnosticLogFields {
  taskRunId: number;
  providerRequestId: number;
  requestKind: TranslationProviderRequestKind;
  missingSegmentCount: number;
  responseDiagnostics?: TranslationProviderResponseDiagnostics;
}

/** Safe terminal diagnostics for an ephemeral Reader selection or paragraph translation. */
export interface TranslationInlineFailedLogContext {
  stage: TranslationInlineFailureStage;
  errorCode: TranslationInlineFailureErrorCode;
  durationMs: number;
  success: false;
}

const TRANSLATION_RUN_FAILURE_ERROR_CODES_BY_STAGE = {
  stream: [
    TRANSLATION_LOG_ERROR_CODES.emptyOutput,
    TRANSLATION_LOG_ERROR_CODES.invalidStructure,
    TRANSLATION_LOG_ERROR_CODES.providerAuth,
    TRANSLATION_LOG_ERROR_CODES.providerRequestFailed,
    TRANSLATION_LOG_ERROR_CODES.providerTimeout,
    TRANSLATION_LOG_ERROR_CODES.networkError,
    TRANSLATION_LOG_ERROR_CODES.unknownError,
  ],
  persist: [TRANSLATION_LOG_ERROR_CODES.unknownError],
} as const satisfies Record<TranslationRunFailureStage, readonly TranslationLogErrorCode[]>;

const TRANSLATION_INLINE_FAILURE_ERROR_CODES_BY_STAGE = {
  configuration: [
    TRANSLATION_INLINE_FAILURE_ERROR_CODES.providerNotConfigured,
    TRANSLATION_INLINE_FAILURE_ERROR_CODES.terminologyUnavailable,
    TRANSLATION_INLINE_FAILURE_ERROR_CODES.unknownError,
  ],
  provider: [
    TRANSLATION_INLINE_FAILURE_ERROR_CODES.providerAuth,
    TRANSLATION_INLINE_FAILURE_ERROR_CODES.providerRequestFailed,
    TRANSLATION_INLINE_FAILURE_ERROR_CODES.providerTimeout,
    TRANSLATION_INLINE_FAILURE_ERROR_CODES.networkError,
    TRANSLATION_INLINE_FAILURE_ERROR_CODES.unknownError,
  ],
  parse: [
    TRANSLATION_INLINE_FAILURE_ERROR_CODES.emptyOutput,
    TRANSLATION_INLINE_FAILURE_ERROR_CODES.invalidStructure,
    TRANSLATION_INLINE_FAILURE_ERROR_CODES.unknownError,
  ],
} as const satisfies Record<
  TranslationInlineFailureStage,
  readonly TranslationInlineFailureErrorCode[]
>;

/** The limited logging surface required by Translation task lifecycle operations. */
export interface TranslationOperationLogger {
  info(
    event:
      | typeof TRANSLATION_LOG_EVENTS.runStarted
      | typeof TRANSLATION_LOG_EVENTS.runCompleted
      | typeof TRANSLATION_LOG_EVENTS.recoveryCompleted,
    component:
      | typeof TRANSLATION_LOG_COMPONENTS.run
      | typeof TRANSLATION_LOG_COMPONENTS.recovery
      | typeof TRANSLATION_LOG_COMPONENTS.providerRequest,
    context:
      | TranslationRunStartedLogContext
      | TranslationRunCompletedLogContext
      | TranslationRecoveryCompletedLogContext,
  ): void;
  warn(
    event:
      | typeof TRANSLATION_LOG_EVENTS.runInterrupted
      | typeof TRANSLATION_LOG_EVENTS.missingSegmentsDetected,
    component:
      | typeof TRANSLATION_LOG_COMPONENTS.run
      | typeof TRANSLATION_LOG_COMPONENTS.providerRecovery,
    context: TranslationRunInterruptedLogContext | TranslationMissingSegmentsLogContext,
  ): void;
  error(
    event:
      | typeof TRANSLATION_LOG_EVENTS.runFailed
      | typeof TRANSLATION_LOG_EVENTS.providerRequestFailed
      | typeof TRANSLATION_LOG_EVENTS.inlineFailed,
    component:
      | typeof TRANSLATION_LOG_COMPONENTS.run
      | typeof TRANSLATION_LOG_COMPONENTS.providerRequest
      | typeof TRANSLATION_LOG_COMPONENTS.inline,
    context:
      | TranslationRunFailedLogContext
      | TranslationProviderRequestFailedLogContext
      | TranslationInlineFailedLogContext,
  ): void;
}

export function elapsedTranslationMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export function logTranslationRunStarted(
  logger: TranslationOperationLogger | undefined,
  context: TranslationRunStartedLogContext,
): void {
  if (!isValidRunStartedContext(context)) return;

  try {
    logger?.info(TRANSLATION_LOG_EVENTS.runStarted, TRANSLATION_LOG_COMPONENTS.run, {
      taskRunId: context.taskRunId,
      ...(context.translationVariant ? { translationVariant: context.translationVariant } : {}),
      trigger: context.trigger,
      previousResultAtStart: context.previousResultAtStart,
    });
  } catch {
    // Logging is observational and must not change Translation task behavior.
  }
}

export function logTranslationRunCompleted(
  logger: TranslationOperationLogger | undefined,
  context: TranslationRunCompletedLogContext,
): void {
  if (
    !isSafeTaskRunId(context.taskRunId)
    || !isSafeDuration(context.durationMs)
    || context.success !== true
    || !isValidRunLifecycle(context)
    || !isValidContextDegradation(context)
    || !isValidRunSummary(context)
  ) {
    return;
  }

  try {
    logger?.info(TRANSLATION_LOG_EVENTS.runCompleted, TRANSLATION_LOG_COMPONENTS.run, {
      taskRunId: context.taskRunId,
      ...(context.translationVariant ? { translationVariant: context.translationVariant } : {}),
      durationMs: context.durationMs,
      success: true,
      trigger: context.trigger,
      previousResultOutcome: context.previousResultOutcome,
      ...toContextDegradationFields(context),
      ...toRunSummaryContext(context),
    });
  } catch {
    // Logging is observational and must not change Translation task behavior.
  }
}

export function logTranslationRunFailed(
  logger: TranslationOperationLogger | undefined,
  context: TranslationRunFailedLogContext,
): void {
  if (
    !isSafeTaskRunId(context.taskRunId)
    || !isSafeDuration(context.durationMs)
    || !isValidRunLifecycle(context)
    || !isValidContextDegradation(context)
    || !isAllowedRunFailure(context.stage, context.errorCode)
    || !isValidRunSummary(context)
  ) {
    return;
  }

  try {
    logger?.error(TRANSLATION_LOG_EVENTS.runFailed, TRANSLATION_LOG_COMPONENTS.run, {
      taskRunId: context.taskRunId,
      ...(context.translationVariant ? { translationVariant: context.translationVariant } : {}),
      ...(context.deepStage ? { deepStage: context.deepStage } : {}),
      durationMs: context.durationMs,
      success: false,
      stage: context.stage,
      errorCode: context.errorCode,
      trigger: context.trigger,
      previousResultOutcome: context.previousResultOutcome,
      ...toContextDegradationFields(context),
      ...toRunSummaryContext(context),
    });
  } catch {
    // Logging is observational and must not change Translation task behavior.
  }
}

export function logTranslationRunInterrupted(
  logger: TranslationOperationLogger | undefined,
  context: TranslationRunInterruptedLogContext,
): void {
  if (
    !isSafeTaskRunId(context.taskRunId)
    || !isSafeDuration(context.durationMs)
    || context.stage !== 'interrupt'
    || context.errorCode !== TRANSLATION_LOG_ERROR_CODES.interrupted
    || !isValidRunLifecycle(context)
    || !TRANSLATION_STOP_REASONS.includes(context.stopReason)
    || !isValidContextDegradation(context)
    || !isValidRunSummary(context)
  ) {
    return;
  }

  try {
    logger?.warn(TRANSLATION_LOG_EVENTS.runInterrupted, TRANSLATION_LOG_COMPONENTS.run, {
      taskRunId: context.taskRunId,
      ...(context.translationVariant ? { translationVariant: context.translationVariant } : {}),
      durationMs: context.durationMs,
      success: false,
      stage: 'interrupt',
      errorCode: TRANSLATION_LOG_ERROR_CODES.interrupted,
      stopReason: context.stopReason,
      trigger: context.trigger,
      previousResultOutcome: context.previousResultOutcome,
      ...toContextDegradationFields(context),
      ...toRunSummaryContext(context),
    });
  } catch {
    // Logging is observational and must not change Translation task behavior.
  }
}

export function logTranslationRecoveryCompleted(
  logger: TranslationOperationLogger | undefined,
  context: TranslationRecoveryCompletedLogContext,
): void {
  if (
    !isSafeDuration(context.durationMs)
    || !isSafePositiveCount(context.count)
    || context.trigger !== 'startup-recovery'
  ) return;

  try {
    logger?.info(TRANSLATION_LOG_EVENTS.recoveryCompleted, TRANSLATION_LOG_COMPONENTS.recovery, {
      durationMs: context.durationMs,
      count: context.count,
      trigger: context.trigger,
    });
  } catch {
    // Logging is observational and must not change Translation recovery behavior.
  }
}

export function logTranslationProviderRequestFailed(
  logger: TranslationOperationLogger | undefined,
  context: TranslationProviderRequestFailedLogContext,
): void {
  if (
    !isValidProviderRequest(context)
    || !isSafeDuration(context.durationMs)
    || context.success !== false
    || !isTranslationLogErrorCode(context.errorCode)
    || context.errorCode === TRANSLATION_LOG_ERROR_CODES.interrupted
    || !isValidUsage(context)
    || !isValidResponseDiagnostics(context.responseDiagnostics)
  ) {
    return;
  }

  try {
    const { responseDiagnostics, ...requestContext } = context;
    logger?.error(
      TRANSLATION_LOG_EVENTS.providerRequestFailed,
      TRANSLATION_LOG_COMPONENTS.providerRequest,
      {
        ...requestContext,
        ...toProviderResponseDiagnosticLogFields(responseDiagnostics),
      },
    );
  } catch {
    // Logging is observational and must not change Translation task behavior.
  }
}

export function logTranslationMissingSegmentsDetected(
  logger: TranslationOperationLogger | undefined,
  context: TranslationMissingSegmentsLogContext,
): void {
  if (
    !isSafeTaskRunId(context.taskRunId)
    || !isSafeProviderRequestId(context.providerRequestId)
    || !TRANSLATION_PROVIDER_REQUEST_KINDS.includes(context.requestKind)
    || !isSafePositiveCount(context.missingSegmentCount)
    || !isValidResponseDiagnostics(context.responseDiagnostics)
  ) {
    return;
  }

  try {
    const { responseDiagnostics, ...requestContext } = context;
    logger?.warn(
      TRANSLATION_LOG_EVENTS.missingSegmentsDetected,
      TRANSLATION_LOG_COMPONENTS.providerRecovery,
      {
        ...requestContext,
        ...toProviderResponseDiagnosticLogFields(responseDiagnostics),
      },
    );
  } catch {
    // Logging is observational and must not change Translation task behavior.
  }
}

export function logTranslationInlineFailed(
  logger: TranslationOperationLogger | undefined,
  context: TranslationInlineFailedLogContext,
): void {
  if (
    !isSafeDuration(context.durationMs)
    || context.success !== false
    || !isAllowedInlineFailure(context.stage, context.errorCode)
  ) {
    return;
  }

  try {
    logger?.error(
      TRANSLATION_LOG_EVENTS.inlineFailed,
      TRANSLATION_LOG_COMPONENTS.inline,
      {
        stage: context.stage,
        errorCode: context.errorCode,
        durationMs: context.durationMs,
        success: false,
      },
    );
  } catch {
    // Logging is observational and must not change inline Translation behavior.
  }
}

function toRunSummaryContext(
  context: TranslationRunDiagnosticSummary,
): TranslationRunDiagnosticSummary {
  return {
    providerRequestCount: context.providerRequestCount,
    batchRequestCount: context.batchRequestCount,
    compensationRequestCount: context.compensationRequestCount,
    ...(context.deepDraftRequestCount ? { deepDraftRequestCount: context.deepDraftRequestCount } : {}),
    ...(context.deepReviewRequestCount ? { deepReviewRequestCount: context.deepReviewRequestCount } : {}),
    ...(context.deepRewriteRequestCount ? { deepRewriteRequestCount: context.deepRewriteRequestCount } : {}),
    providerRequestSuccessCount: context.providerRequestSuccessCount,
    providerRequestFailureCount: context.providerRequestFailureCount,
    missingSegmentCount: context.missingSegmentCount,
    unresolvedMissingSegmentCount: context.unresolvedMissingSegmentCount,
    ...(context.inputTokens === undefined ? {} : { inputTokens: context.inputTokens }),
    ...(context.outputTokens === undefined ? {} : { outputTokens: context.outputTokens }),
    ...(context.totalTokens === undefined ? {} : { totalTokens: context.totalTokens }),
  };
}

function toProviderResponseDiagnosticLogFields(
  diagnostics: TranslationProviderResponseDiagnostics | undefined,
): TranslationProviderResponseDiagnosticLogFields {
  if (!diagnostics) return {};
  return {
    ...(diagnostics.reasonCode === undefined ? {} : { reasonCode: diagnostics.reasonCode }),
    ...(diagnostics.failurePhase === undefined
      ? {}
      : { validationStage: diagnostics.failurePhase }),
    ...(diagnostics.htmlValidationReason === undefined
      ? {}
      : { htmlValidationReason: diagnostics.htmlValidationReason }),
    ...(diagnostics.compensationProtocol === undefined
      ? {}
      : { compensationProtocol: diagnostics.compensationProtocol }),
    ...(diagnostics.finishReason === undefined ? {} : { finishReason: diagnostics.finishReason }),
    ...(diagnostics.expectedSegmentCount === undefined
      ? {}
      : { expectedSegmentCount: diagnostics.expectedSegmentCount }),
    ...(diagnostics.parsedSegmentCount === undefined
      ? {}
      : { parsedSegmentCount: diagnostics.parsedSegmentCount }),
    ...(diagnostics.acceptedSegmentCount === undefined
      ? {}
      : { acceptedSegmentCount: diagnostics.acceptedSegmentCount }),
    ...(diagnostics.missingSegmentCount === undefined
      ? {}
      : { missingSegmentCount: diagnostics.missingSegmentCount }),
    ...(diagnostics.duplicateSegmentCount === undefined
      ? {}
      : { duplicateSegmentCount: diagnostics.duplicateSegmentCount }),
    ...(diagnostics.unexpectedSegmentCount === undefined
      ? {}
      : { unexpectedSegmentCount: diagnostics.unexpectedSegmentCount }),
    ...(diagnostics.malformedRecordCount === undefined
      ? {}
      : { malformedRecordCount: diagnostics.malformedRecordCount }),
    ...(diagnostics.emptyTranslationCount === undefined
      ? {}
      : { emptyTranslationCount: diagnostics.emptyTranslationCount }),
    ...(diagnostics.expectedTextSlotCount === undefined
      ? {}
      : { expectedTextSlotCount: diagnostics.expectedTextSlotCount }),
    ...(diagnostics.parsedTextSlotCount === undefined
      ? {}
      : { parsedTextSlotCount: diagnostics.parsedTextSlotCount }),
    ...(diagnostics.acceptedTextSlotCount === undefined
      ? {}
      : { acceptedTextSlotCount: diagnostics.acceptedTextSlotCount }),
    ...(diagnostics.missingTextSlotCount === undefined
      ? {}
      : { missingTextSlotCount: diagnostics.missingTextSlotCount }),
    ...(diagnostics.duplicateTextSlotCount === undefined
      ? {}
      : { duplicateTextSlotCount: diagnostics.duplicateTextSlotCount }),
    ...(diagnostics.unexpectedTextSlotCount === undefined
      ? {}
      : { unexpectedTextSlotCount: diagnostics.unexpectedTextSlotCount }),
    ...(diagnostics.malformedTextSlotCount === undefined
      ? {}
      : { malformedTextSlotCount: diagnostics.malformedTextSlotCount }),
    ...(diagnostics.emptyTextSlotCount === undefined
      ? {}
      : { emptyTextSlotCount: diagnostics.emptyTextSlotCount }),
    ...(diagnostics.inputCharacters === undefined
      ? {}
      : { inputCharacters: diagnostics.inputCharacters }),
    ...(diagnostics.outputCharacters === undefined
      ? {}
      : { outputCharacters: diagnostics.outputCharacters }),
    ...(diagnostics.affectedSegmentIdHashes === undefined
      ? {}
      : { affectedSegmentIdHashes: [...diagnostics.affectedSegmentIdHashes] }),
  };
}

function isAllowedRunFailure(
  stage: unknown,
  errorCode: unknown,
): stage is TranslationRunFailureStage {
  if (!TRANSLATION_RUN_FAILURE_STAGES.includes(stage as TranslationRunFailureStage)) {
    return false;
  }

  return TRANSLATION_RUN_FAILURE_ERROR_CODES_BY_STAGE[
    stage as TranslationRunFailureStage
  ].includes(errorCode as never);
}

function isAllowedInlineFailure(
  stage: unknown,
  errorCode: unknown,
): stage is TranslationInlineFailureStage {
  if (!TRANSLATION_INLINE_FAILURE_STAGES.includes(stage as TranslationInlineFailureStage)) {
    return false;
  }

  return TRANSLATION_INLINE_FAILURE_ERROR_CODES_BY_STAGE[
    stage as TranslationInlineFailureStage
  ].includes(errorCode as never);
}

function isValidRunSummary(context: TranslationRunDiagnosticSummary): boolean {
  return isSafeCount(context.providerRequestCount)
    && isSafeCount(context.batchRequestCount)
    && isSafeCount(context.compensationRequestCount)
    && isSafeCount(context.deepDraftRequestCount ?? 0)
    && isSafeCount(context.deepReviewRequestCount ?? 0)
    && isSafeCount(context.deepRewriteRequestCount ?? 0)
    && isSafeCount(context.providerRequestSuccessCount)
    && isSafeCount(context.providerRequestFailureCount)
    && isSafeCount(context.missingSegmentCount)
    && isSafeCount(context.unresolvedMissingSegmentCount)
    && isValidUsage(context);
}

function isValidRunLifecycle(context: {
  taskRunId: number;
  trigger: TranslationLogTrigger;
  previousResultOutcome: TranslationPreviousResultOutcome;
  translationVariant?: TranslationResultVariant;
}): boolean {
  return isSafeTaskRunId(context.taskRunId)
    && TRANSLATION_LOG_TRIGGERS.includes(context.trigger)
    && TRANSLATION_PREVIOUS_RESULT_OUTCOMES.includes(context.previousResultOutcome)
    && (context.translationVariant === undefined
      || ['standard', 'deep', 'legacy-pre-mode'].includes(context.translationVariant));
}

function isValidRunStartedContext(context: {
  taskRunId: number;
  trigger: TranslationLogTrigger;
  previousResultAtStart: TranslationPreviousResultAtStart;
  translationVariant?: TranslationResultVariant;
}): boolean {
  return isSafeTaskRunId(context.taskRunId)
    && TRANSLATION_LOG_TRIGGERS.includes(context.trigger)
    && TRANSLATION_PREVIOUS_RESULT_AT_START_VALUES.includes(context.previousResultAtStart)
    && ['standard', 'deep', 'legacy-pre-mode'].includes(context.translationVariant ?? 'standard');
}

function isValidContextDegradation(context: {
  contextDegraded?: true;
  contextWarningCode?: TranslationContextWarningCode;
}): boolean {
  return (context.contextDegraded === undefined && context.contextWarningCode === undefined)
    || (
      context.contextDegraded === true
      && context.contextWarningCode !== undefined
      && TRANSLATION_CONTEXT_WARNING_CODES.includes(context.contextWarningCode)
    );
}

function toContextDegradationFields(context: {
  contextDegraded?: true;
  contextWarningCode?: TranslationContextWarningCode;
}): Pick<TranslationRunCompletedLogContext, 'contextDegraded' | 'contextWarningCode'> {
  return context.contextDegraded === true && context.contextWarningCode !== undefined
    ? {
        contextDegraded: true,
        contextWarningCode: context.contextWarningCode,
      }
    : {};
}

function isValidProviderRequest(context: {
  taskRunId: number;
  providerRequestId: number;
  requestKind: TranslationProviderRequestKind;
  segmentCount: number;
}): boolean {
  return isSafeTaskRunId(context.taskRunId)
    && isSafeProviderRequestId(context.providerRequestId)
    && TRANSLATION_PROVIDER_REQUEST_KINDS.includes(context.requestKind)
    && isSafePositiveCount(context.segmentCount);
}

function isValidUsage(context: ProviderTokenUsage): boolean {
  return isSafeOptionalTokenCount(context.inputTokens)
    && isSafeOptionalTokenCount(context.outputTokens)
    && isSafeOptionalTokenCount(context.totalTokens);
}

function isValidResponseDiagnostics(
  diagnostics: TranslationProviderResponseDiagnostics | undefined,
): boolean {
  if (!diagnostics) return true;
  const counts = [
    diagnostics.expectedSegmentCount,
    diagnostics.parsedSegmentCount,
    diagnostics.acceptedSegmentCount,
    diagnostics.missingSegmentCount,
    diagnostics.duplicateSegmentCount,
    diagnostics.unexpectedSegmentCount,
    diagnostics.malformedRecordCount,
    diagnostics.emptyTranslationCount,
    diagnostics.inputCharacters,
    diagnostics.outputCharacters,
  ];
  if (counts.some((count) => count === undefined)) return false;
  if (!counts.every((count) => isSafeCount(count ?? -1))) return false;
  if (
    diagnostics.reasonCode !== undefined
    && !Object.values(TRANSLATION_OUTPUT_REASON_CODES).includes(diagnostics.reasonCode)
  ) {
    return false;
  }
  if (
    diagnostics.failurePhase !== undefined
    && !TRANSLATION_OUTPUT_FAILURE_PHASES.includes(diagnostics.failurePhase)
  ) {
    return false;
  }
  if (diagnostics.reasonCode !== undefined && diagnostics.failurePhase === undefined) return false;
  const textSlotCounts = [
    diagnostics.expectedTextSlotCount,
    diagnostics.parsedTextSlotCount,
    diagnostics.acceptedTextSlotCount,
    diagnostics.missingTextSlotCount,
    diagnostics.duplicateTextSlotCount,
    diagnostics.unexpectedTextSlotCount,
    diagnostics.malformedTextSlotCount,
    diagnostics.emptyTextSlotCount,
  ];
  const hasTextSlotCounts = textSlotCounts.some((count) => count !== undefined);
  if (
    diagnostics.compensationProtocol !== undefined
    && !TRANSLATION_COMPENSATION_PROTOCOLS.includes(diagnostics.compensationProtocol)
  ) {
    return false;
  }
  if (
    diagnostics.compensationProtocol === undefined
    ? hasTextSlotCounts
    : textSlotCounts.some((count) => count === undefined || !isSafeCount(count))
  ) {
    return false;
  }
  if (
    diagnostics.htmlValidationReason !== undefined
    && !Object.values(TRANSLATION_HTML_VALIDATION_REASONS)
      .includes(diagnostics.htmlValidationReason)
  ) {
    return false;
  }
  if (
    diagnostics.htmlValidationReason !== undefined
    && diagnostics.reasonCode !== TRANSLATION_OUTPUT_REASON_CODES.htmlStructureInvalid
  ) {
    return false;
  }
  if (
    diagnostics.htmlValidationReason !== undefined
    && diagnostics.failurePhase !== 'html-validation'
  ) {
    return false;
  }
  if (
    diagnostics.finishReason !== undefined
    && !['stop', 'length', 'content-filter', 'other'].includes(diagnostics.finishReason)
  ) {
    return false;
  }
  return diagnostics.affectedSegmentIdHashes === undefined
    || (
      diagnostics.affectedSegmentIdHashes.length <= 3
      && diagnostics.affectedSegmentIdHashes.every((hash) => /^[a-f0-9]{16}$/.test(hash))
    );
}

function isTranslationLogErrorCode(value: unknown): value is TranslationLogErrorCode {
  return Object.values(TRANSLATION_LOG_ERROR_CODES).includes(value as TranslationLogErrorCode);
}

function isSafeTaskRunId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isSafeProviderRequestId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isSafeDuration(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isSafeCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isSafePositiveCount(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isSafeOptionalTokenCount(value: number | undefined): boolean {
  return value === undefined || (Number.isSafeInteger(value) && value >= 0);
}
