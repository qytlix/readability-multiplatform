import type { ShaleError } from './feed.ipc';

export const TRANSLATION_TARGET_LANGUAGES = ['zh-CN', 'en'] as const;
export type TranslationTargetLanguage = (typeof TRANSLATION_TARGET_LANGUAGES)[number];

export type TranslationRunStatus = 'running' | 'succeeded' | 'failed';
export type TranslationSegmentStatus = 'pending' | 'succeeded' | 'failed';

export interface TranslationSegment {
  sourceSegmentId: string;
  orderIndex: number;
  sourceText: string;
  translatedText?: string;
  status: TranslationSegmentStatus;
  error?: ShaleError;
}

export interface TranslationResult {
  id: number;
  entryId: number;
  targetLanguage: TranslationTargetLanguage;
  sourceContentHash: string;
  segmenterVersion: string;
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

export interface TranslationGenerateResponse {
  runId: number;
  reused: boolean;
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
      type: 'segment-delta';
      sourceSegmentId: string;
      text: string;
    })
  | (TranslationStreamEventBase & { type: 'completed'; result: TranslationResult })
  | (TranslationStreamEventBase & { type: 'failed'; error: ShaleError });
