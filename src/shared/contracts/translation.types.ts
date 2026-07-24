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
  contextPromptVersion: string;
  contextWarning?: ShaleError;
  status: TranslationRunStatus;
  error?: ShaleError;
  createdAt: string;
  completedAt?: string;
  updatedAt: string;
  segments: TranslationSegment[];
}

export type TranslationState =
  | { state: 'idle' }
  | { state: 'stale' }
  | { state: 'running'; result: TranslationResult }
  | { state: 'failed'; result: TranslationResult }
  | { state: 'succeeded'; result: TranslationResult };

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
}

export type TranslationGenerateRequest = TranslationGetRequest;

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
}

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
  | (TranslationStreamEventBase & { type: 'completed'; result: TranslationResult })
  | (TranslationStreamEventBase & { type: 'failed'; error: ShaleError });
