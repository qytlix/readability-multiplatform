import type { ContentSegmentType } from './content.types';
import type { ShaleError } from './feed.ipc';

export const TRANSLATION_TARGET_LANGUAGES = ['zh-CN', 'en'] as const;
export type TranslationTargetLanguage = (typeof TRANSLATION_TARGET_LANGUAGES)[number];

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
  sourceTerm: string;
  targetTerm: string;
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
  targetLanguage: TranslationTargetLanguage;
  sourceContentHash: string;
  segmenterVersion: string;
  terminologyPackVersion: string;
  promptVersion: string;
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
  targetLanguage: TranslationTargetLanguage;
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

export interface InlineTranslationRequest {
  kind: InlineTranslationKind;
  sourceText: string;
  context?: string;
  targetLanguage: TranslationTargetLanguage;
}

export interface InlineTranslationExample {
  source: string;
  target: string;
}

export interface InlineTranslationResult {
  kind: InlineTranslationKind;
  sourceText: string;
  targetLanguage: TranslationTargetLanguage;
  translation: string;
  pronunciation?: string;
  partOfSpeech?: string;
  explanation?: string;
  examples: InlineTranslationExample[];
}

interface TranslationStreamEventBase {
  runId: number;
  entryId: number;
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
