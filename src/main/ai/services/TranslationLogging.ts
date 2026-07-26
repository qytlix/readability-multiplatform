import { performance } from 'node:perf_hooks';
import type { ProviderTokenUsage } from '../provider/SummaryProvider';
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
  providerRequestStarted: 'translation.provider.request.started',
  providerRequestCompleted: 'translation.provider.request.completed',
  providerRequestFailed: 'translation.provider.request.failed',
  missingSegmentsDetected: 'translation.provider.omission.detected',
} as const;

export const TRANSLATION_LOG_COMPONENTS = {
  run: 'translation.run',
  recovery: 'translation.recovery',
  providerRequest: 'translation.provider.request',
  providerRecovery: 'translation.provider.recovery',
} as const;

export const TRANSLATION_RUN_FAILURE_STAGES = ['stream', 'persist'] as const;
export const TRANSLATION_PROVIDER_REQUEST_KINDS = ['batch', 'compensation'] as const;

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

export type TranslationRunFailureStage = (typeof TRANSLATION_RUN_FAILURE_STAGES)[number];
export type TranslationProviderRequestKind = (
  typeof TRANSLATION_PROVIDER_REQUEST_KINDS
)[number];
export type TranslationLogErrorCode = (
  typeof TRANSLATION_LOG_ERROR_CODES
)[keyof typeof TRANSLATION_LOG_ERROR_CODES];

export interface TranslationRunStartedLogContext {
  taskRunId: number;
}

/** Aggregate counts for a Translation run; no segment identity or content is included. */
export interface TranslationRunDiagnosticSummary extends ProviderTokenUsage {
  providerRequestCount: number;
  batchRequestCount: number;
  compensationRequestCount: number;
  providerRequestSuccessCount: number;
  providerRequestFailureCount: number;
  missingSegmentCount: number;
}

export interface TranslationRunCompletedLogContext extends TranslationRunDiagnosticSummary {
  taskRunId: number;
  durationMs: number;
  success: true;
}

export interface TranslationRunFailedLogContext extends TranslationRunDiagnosticSummary {
  taskRunId: number;
  durationMs: number;
  success: false;
  stage: TranslationRunFailureStage;
  errorCode: TranslationLogErrorCode;
}

export interface TranslationRunInterruptedLogContext {
  taskRunId: number;
  durationMs: number;
  success: false;
  stage: 'interrupt';
  errorCode: typeof TRANSLATION_LOG_ERROR_CODES.interrupted;
}

export interface TranslationRecoveryCompletedLogContext {
  durationMs: number;
  count: number;
}

export interface TranslationProviderRequestStartedLogContext {
  taskRunId: number;
  providerRequestId: number;
  requestKind: TranslationProviderRequestKind;
  segmentCount: number;
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

export interface TranslationProviderRequestCompletedLogContext
  extends ProviderTokenUsage, TranslationProviderResponseDiagnosticLogFields {
  taskRunId: number;
  providerRequestId: number;
  requestKind: TranslationProviderRequestKind;
  segmentCount: number;
  durationMs: number;
  success: true;
  responseDiagnostics?: TranslationProviderResponseDiagnostics;
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

/** The limited logging surface required by Translation task lifecycle operations. */
export interface TranslationOperationLogger {
  info(
    event:
      | typeof TRANSLATION_LOG_EVENTS.runStarted
      | typeof TRANSLATION_LOG_EVENTS.runCompleted
      | typeof TRANSLATION_LOG_EVENTS.recoveryCompleted
      | typeof TRANSLATION_LOG_EVENTS.providerRequestStarted
      | typeof TRANSLATION_LOG_EVENTS.providerRequestCompleted,
    component:
      | typeof TRANSLATION_LOG_COMPONENTS.run
      | typeof TRANSLATION_LOG_COMPONENTS.recovery
      | typeof TRANSLATION_LOG_COMPONENTS.providerRequest,
    context:
      | TranslationRunStartedLogContext
      | TranslationRunCompletedLogContext
      | TranslationRecoveryCompletedLogContext
      | TranslationProviderRequestStartedLogContext
      | TranslationProviderRequestCompletedLogContext,
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
      | typeof TRANSLATION_LOG_EVENTS.providerRequestFailed,
    component:
      | typeof TRANSLATION_LOG_COMPONENTS.run
      | typeof TRANSLATION_LOG_COMPONENTS.providerRequest,
    context: TranslationRunFailedLogContext | TranslationProviderRequestFailedLogContext,
  ): void;
}

export function elapsedTranslationMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export function logTranslationRunStarted(
  logger: TranslationOperationLogger | undefined,
  context: TranslationRunStartedLogContext,
): void {
  if (!isSafeTaskRunId(context.taskRunId)) return;

  try {
    logger?.info(TRANSLATION_LOG_EVENTS.runStarted, TRANSLATION_LOG_COMPONENTS.run, {
      taskRunId: context.taskRunId,
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
    || !isValidRunSummary(context)
  ) {
    return;
  }

  try {
    logger?.info(TRANSLATION_LOG_EVENTS.runCompleted, TRANSLATION_LOG_COMPONENTS.run, {
      taskRunId: context.taskRunId,
      durationMs: context.durationMs,
      success: true,
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
    || !isAllowedRunFailure(context.stage, context.errorCode)
    || !isValidRunSummary(context)
  ) {
    return;
  }

  try {
    logger?.error(TRANSLATION_LOG_EVENTS.runFailed, TRANSLATION_LOG_COMPONENTS.run, {
      taskRunId: context.taskRunId,
      durationMs: context.durationMs,
      success: false,
      stage: context.stage,
      errorCode: context.errorCode,
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
  ) {
    return;
  }

  try {
    logger?.warn(TRANSLATION_LOG_EVENTS.runInterrupted, TRANSLATION_LOG_COMPONENTS.run, {
      taskRunId: context.taskRunId,
      durationMs: context.durationMs,
      success: false,
      stage: 'interrupt',
      errorCode: TRANSLATION_LOG_ERROR_CODES.interrupted,
    });
  } catch {
    // Logging is observational and must not change Translation task behavior.
  }
}

export function logTranslationRecoveryCompleted(
  logger: TranslationOperationLogger | undefined,
  context: TranslationRecoveryCompletedLogContext,
): void {
  if (!isSafeDuration(context.durationMs) || !isSafeCount(context.count)) return;

  try {
    logger?.info(TRANSLATION_LOG_EVENTS.recoveryCompleted, TRANSLATION_LOG_COMPONENTS.recovery, {
      durationMs: context.durationMs,
      count: context.count,
    });
  } catch {
    // Logging is observational and must not change Translation recovery behavior.
  }
}

export function logTranslationProviderRequestStarted(
  logger: TranslationOperationLogger | undefined,
  context: TranslationProviderRequestStartedLogContext,
): void {
  if (!isValidProviderRequest(context)) return;

  try {
    logger?.info(
      TRANSLATION_LOG_EVENTS.providerRequestStarted,
      TRANSLATION_LOG_COMPONENTS.providerRequest,
      { ...context },
    );
  } catch {
    // Logging is observational and must not change Translation task behavior.
  }
}

export function logTranslationProviderRequestCompleted(
  logger: TranslationOperationLogger | undefined,
  context: TranslationProviderRequestCompletedLogContext,
): void {
  if (
    !isValidProviderRequest(context)
    || !isSafeDuration(context.durationMs)
    || context.success !== true
    || !isValidUsage(context)
    || !isValidResponseDiagnostics(context.responseDiagnostics)
  ) {
    return;
  }

  try {
    const { responseDiagnostics, ...requestContext } = context;
    logger?.info(
      TRANSLATION_LOG_EVENTS.providerRequestCompleted,
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

export function logTranslationProviderRequestFailed(
  logger: TranslationOperationLogger | undefined,
  context: TranslationProviderRequestFailedLogContext,
): void {
  if (
    !isValidProviderRequest(context)
    || !isSafeDuration(context.durationMs)
    || context.success !== false
    || !isTranslationLogErrorCode(context.errorCode)
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

function toRunSummaryContext(
  context: TranslationRunDiagnosticSummary,
): TranslationRunDiagnosticSummary {
  return {
    providerRequestCount: context.providerRequestCount,
    batchRequestCount: context.batchRequestCount,
    compensationRequestCount: context.compensationRequestCount,
    providerRequestSuccessCount: context.providerRequestSuccessCount,
    providerRequestFailureCount: context.providerRequestFailureCount,
    missingSegmentCount: context.missingSegmentCount,
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

function isValidRunSummary(context: TranslationRunDiagnosticSummary): boolean {
  return isSafeCount(context.providerRequestCount)
    && isSafeCount(context.batchRequestCount)
    && isSafeCount(context.compensationRequestCount)
    && isSafeCount(context.providerRequestSuccessCount)
    && isSafeCount(context.providerRequestFailureCount)
    && isSafeCount(context.missingSegmentCount)
    && isValidUsage(context);
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
