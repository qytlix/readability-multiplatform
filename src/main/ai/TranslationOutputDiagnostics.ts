import { createHash } from 'node:crypto';
import {
  TRANSLATION_ERROR_CODES,
  TranslationError,
  type TranslationErrorCode,
} from '../../shared/errors/translation.errors';

/**
 * Internal-only reasons for a Translation provider response rejection.
 * These codes are safe for structured logs and are never sent through IPC.
 */
export const TRANSLATION_OUTPUT_REASON_CODES = {
  responseEmpty: 'response_empty',
  streamTailIncomplete: 'stream_tail_incomplete',
  ndjsonSyntax: 'ndjson_syntax_error',
  requiredFieldMissing: 'required_field_missing',
  invalidFieldType: 'invalid_field_type',
  translatedHtmlEmpty: 'translated_html_empty',
  segmentIdMissing: 'segment_id_missing',
  segmentIdDuplicate: 'segment_id_duplicate',
  segmentIdUnexpected: 'segment_id_unexpected',
  expectedSegmentMissing: 'expected_segment_missing',
  textSlotIdMissing: 'text_slot_id_missing',
  textSlotIdDuplicate: 'text_slot_id_duplicate',
  textSlotIdUnexpected: 'text_slot_id_unexpected',
  expectedTextSlotMissing: 'expected_text_slot_missing',
  translatedTextEmpty: 'translated_text_empty',
  htmlStructureInvalid: 'html_structure_invalid',
  providerLengthTruncated: 'provider_length_truncated',
  unclassified: 'unclassified_output_failure',
} as const;

export type TranslationOutputReasonCode = (
  typeof TRANSLATION_OUTPUT_REASON_CODES
)[keyof typeof TRANSLATION_OUTPUT_REASON_CODES];

/**
 * Stable, content-free detail for failures that retain the public
 * `html_structure_invalid` reason. These values describe only the validator
 * branch; they never contain article or model HTML.
 */
export const TRANSLATION_HTML_VALIDATION_REASONS = {
  rootMissing: 'html_root_missing',
  multipleRoots: 'html_multiple_roots',
  elementCountMismatch: 'html_element_count_mismatch',
  elementTagMismatch: 'html_element_tag_mismatch',
  elementNestingMismatch: 'html_element_nesting_mismatch',
  textSlotMismatch: 'html_text_slot_mismatch',
} as const;

export type TranslationHtmlValidationReason = (
  typeof TRANSLATION_HTML_VALIDATION_REASONS
)[keyof typeof TRANSLATION_HTML_VALIDATION_REASONS];

export const TRANSLATION_OUTPUT_FAILURE_PHASES = [
  'stream',
  'record',
  'segment-id',
  'html-validation',
  'completion',
] as const;

export type TranslationOutputFailurePhase = (
  typeof TRANSLATION_OUTPUT_FAILURE_PHASES
)[number];

/**
 * Preserves the public Translation error code while carrying a private,
 * non-content diagnostic reason to the structured logger.
 */
export class TranslationOutputDiagnosticError extends TranslationError {
  constructor(
    public readonly reasonCode: TranslationOutputReasonCode,
    public readonly failurePhase: TranslationOutputFailurePhase,
    code: TranslationErrorCode,
    message: string,
    retryable: boolean,
    public readonly htmlValidationReason?: TranslationHtmlValidationReason,
  ) {
    super(code, message, retryable);
    this.name = 'TranslationOutputDiagnosticError';
  }
}

export function invalidTranslationStructure(
  reasonCode: TranslationOutputReasonCode,
  failurePhase: TranslationOutputFailurePhase,
  message: string,
): TranslationOutputDiagnosticError {
  return new TranslationOutputDiagnosticError(
    reasonCode,
    failurePhase,
    TRANSLATION_ERROR_CODES.TRANSLATION_INVALID_STRUCTURE,
    message,
    true,
  );
}

export function emptyTranslationOutput(
  message: string,
): TranslationOutputDiagnosticError {
  return new TranslationOutputDiagnosticError(
    TRANSLATION_OUTPUT_REASON_CODES.translatedHtmlEmpty,
    'html-validation',
    TRANSLATION_ERROR_CODES.TRANSLATION_EMPTY_OUTPUT,
    message,
    true,
  );
}

export function invalidTranslationHtmlStructure(
  htmlValidationReason: TranslationHtmlValidationReason,
  message: string,
): TranslationOutputDiagnosticError {
  return new TranslationOutputDiagnosticError(
    TRANSLATION_OUTPUT_REASON_CODES.htmlStructureInvalid,
    'html-validation',
    TRANSLATION_ERROR_CODES.TRANSLATION_INVALID_STRUCTURE,
    message,
    true,
    htmlValidationReason,
  );
}

/** A short, stable hash lets diagnostics identify a local segment without content. */
export function hashTranslationSegmentId(sourceSegmentId: string): string {
  return createHash('sha256').update(sourceSegmentId, 'utf8').digest('hex').slice(0, 16);
}

export function getTranslationOutputDiagnostic(error: unknown): {
  reasonCode: TranslationOutputReasonCode;
  failurePhase: TranslationOutputFailurePhase;
  htmlValidationReason?: TranslationHtmlValidationReason;
} | undefined {
  if (!(error instanceof TranslationOutputDiagnosticError)) return undefined;
  return {
    reasonCode: error.reasonCode,
    failurePhase: error.failurePhase,
    ...(error.htmlValidationReason === undefined
      ? {}
      : { htmlValidationReason: error.htmlValidationReason }),
  };
}
