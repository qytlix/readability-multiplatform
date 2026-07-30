import type { ContentSegmentType } from './content.types';
import type { ShaleError } from './feed.ipc';

export const TRANSLATION_TARGET_LANGUAGES = [
  'zh-CN',
  'zh-HK',
  'ja',
  'ko',
  'de',
  'fr',
  'es',
  'en',
] as const;
export type TranslationTargetLanguage = (typeof TRANSLATION_TARGET_LANGUAGES)[number];
export const TRANSLATION_SOURCE_LANGUAGES = [
  'auto',
  ...TRANSLATION_TARGET_LANGUAGES,
] as const;
export type TranslationSourceLanguage = (typeof TRANSLATION_SOURCE_LANGUAGES)[number];

export const TRANSLATION_LANGUAGE_LABELS: Record<TranslationTargetLanguage, string> = {
  'zh-CN': 'Simplified Chinese',
  'zh-HK': 'Traditional Chinese (Hong Kong)',
  ja: 'Japanese',
  ko: 'Korean',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  en: 'English',
};

export type TranslationRunStatus = 'running' | 'succeeded' | 'failed';
export type TranslationSegmentStatus = 'pending' | 'succeeded' | 'failed';

/**
 * Product translation modes. Only `standard` is executable today; `deep` is
 * reserved so stored results have an explicit, stable mode identity before it
 * is introduced.
 */
export const TRANSLATION_MODES = ['standard', 'deep'] as const;
export type TranslationMode = (typeof TRANSLATION_MODES)[number];
export const STANDARD_TRANSLATION_MODE = 'standard' as const;
export const DEEP_TRANSLATION_MODE = 'deep' as const;

/**
 * Results created before mode identity was generalized remain readable, but
 * cannot be reused as a current product mode.
 */
export const LEGACY_TRANSLATION_VARIANT = 'legacy-pre-mode' as const;
export type TranslationResultVariant = TranslationMode | typeof LEGACY_TRANSLATION_VARIANT;

export interface TranslationSegment {
  sourceSegmentId: string;
  orderIndex: number;
  sourceType: ContentSegmentType;
  sourceHtml: string;
  sourceText: string;
  translatedText?: string;
  translatedHtml?: string;
  terminologyMatches: TranslationTerminologyMatch[];
  status: TranslationSegmentStatus;
  error?: ShaleError;
}

export interface TranslationTerminologyMatch {
  conceptId: string;
  sourceId: string;
  libraryId?: string;
  sourceTerm: string;
  targetTerm: string;
  provenanceTargetLanguage?: 'zh-TW';
  definition?: string;
  domain?: string;
  reliability?: number;
}

export interface TerminologyPackSource {
  id: string;
  name: string;
  version: string;
  license: string;
  attribution: string;
  sourceUrl: string;
}

export interface TerminologyPackInfo {
  version: string;
  sources: TerminologyPackSource[];
}

export interface TranslationResult {
  id: number;
  entryId: number;
  sourceLanguage: TranslationSourceLanguage;
  targetLanguage: TranslationTargetLanguage;
  sourceContentHash: string;
  segmenterVersion: string;
  terminologyPackVersion: string;
  promptVersion: string;
  expertId: string;
  expertContentHash: string;
  smartContextEnabled: boolean;
  /** Immutable generation identity captured when this run was created. */
  translationVariant: TranslationResultVariant;
  contextPromptVersion: string;
  contextWarning?: ShaleError;
  status: TranslationRunStatus;
  error?: ShaleError;
  createdAt: string;
  completedAt?: string;
  updatedAt: string;
  segments: TranslationSegment[];
}

type TranslationStateWithResult = {
  result: TranslationResult;
  /** The persisted, complete result that Reader and export may safely use. */
  activeResult?: TranslationResult;
};

export type TranslationState =
  | { state: 'idle' }
  | { state: 'stale' }
  | ({ state: 'running' } & TranslationStateWithResult)
  | ({ state: 'paused' } & TranslationStateWithResult)
  | ({ state: 'failed' } & TranslationStateWithResult)
  | ({ state: 'succeeded' } & TranslationStateWithResult);

export interface TranslationGetRequest {
  entryId: number;
  sourceLanguage: TranslationSourceLanguage;
  targetLanguage: TranslationTargetLanguage;
  /** Defaults to true when omitted for backward compatibility. */
  useTerminology?: boolean;
  /** Defaults to `none` when omitted for backward compatibility. */
  expertId?: string;
  /** Defaults to false when omitted for backward compatibility. */
  useSmartContext?: boolean;
  /** Defaults to `standard` when omitted for backward compatibility. */
  translationMode?: TranslationMode;
}

export interface TranslationGenerateRequest extends TranslationGetRequest {
  /** Always create a candidate run instead of reusing or resuming a prior run. */
  forceNew?: boolean;
}

export interface TranslationPrioritizeRequest extends TranslationGetRequest {
  runId: number;
  sourceSegmentIds: string[];
}

export interface TranslationPrioritizeResponse {
  accepted: boolean;
}

export interface TranslationGenerateResponse {
  runId: number;
  reused: boolean;
  result: TranslationResult;
  /** A complete result retained while a replacement candidate is running. */
  activeResult?: TranslationResult;
}

export interface TranslationPauseRequest extends TranslationGetRequest {
  runId: number;
}

export type TranslationPauseResponse =
  | { paused: false }
  | { paused: true; result: TranslationResult };

export type InlineTranslationKind = 'selection' | 'paragraph';
export type InlineTranslationInputKind = 'word' | 'phrase' | 'sentence';
export type InlinePronunciationSystem =
  | 'ipa'
  | 'pinyin'
  | 'jyutping'
  | 'kana'
  | 'revised-romanization';

export interface InlineTranslationRequest {
  kind: InlineTranslationKind;
  sourceText: string;
  context?: string;
  sourceLanguage: TranslationSourceLanguage;
  targetLanguage: TranslationTargetLanguage;
  /** Defaults to true when omitted for backward compatibility. */
  useTerminology?: boolean;
  /** Defaults to `none` when omitted for backward compatibility. */
  expertId?: string;
}

export interface InlineTranslationExample {
  source: string;
  translation: string;
}

export interface InlineTranslationSense {
  partOfSpeech: string;
  definitions: string[];
  contextualMeaning?: string;
  examples: InlineTranslationExample[];
}

export interface InlineTranslationResult {
  kind: InlineTranslationKind;
  inputKind: InlineTranslationInputKind;
  sourceText: string;
  sourceLanguage: TranslationSourceLanguage;
  detectedSourceLanguage: TranslationTargetLanguage;
  targetLanguage: TranslationTargetLanguage;
  translation: string;
  pronunciation?: string;
  pronunciationSystem?: InlinePronunciationSystem;
  senses: InlineTranslationSense[];
}

export interface InlineTranslationCancelResult {
  cancelled: boolean;
}

interface TranslationStreamEventBase {
  runId: number;
  entryId: number;
  sourceLanguage: TranslationSourceLanguage;
  targetLanguage: TranslationTargetLanguage;
}

export type TranslationStreamEvent =
  | (TranslationStreamEventBase & { type: 'started' })
  | (TranslationStreamEventBase & {
      type: 'segment-started';
      sourceSegmentId: string;
      orderIndex: number;
    })
  | (TranslationStreamEventBase & {
      type: 'segment-completed';
      sourceSegmentId: string;
      segment: TranslationSegment;
    })
  | (TranslationStreamEventBase & {
      type: 'segment-failed';
      sourceSegmentId: string;
      segment: TranslationSegment;
    })
  | (TranslationStreamEventBase & { type: 'paused'; result: TranslationResult })
  | (TranslationStreamEventBase & { type: 'completed'; result: TranslationResult })
  | (TranslationStreamEventBase & { type: 'failed'; error: ShaleError });
