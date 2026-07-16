import type { ShaleError } from './feed.ipc';

export const SUMMARY_TARGET_LANGUAGES = ['zh-CN', 'en'] as const;
export type SummaryTargetLanguage = (typeof SUMMARY_TARGET_LANGUAGES)[number];

export const SUMMARY_DETAIL_LEVELS = ['short', 'medium', 'detailed'] as const;
export type SummaryDetailLevel = (typeof SUMMARY_DETAIL_LEVELS)[number];

export type SummaryRunStatus = 'running' | 'succeeded' | 'failed';
export type SummaryFreshness = 'fresh' | 'stale';

export interface SummaryRun {
  id: number;
  entryId: number;
  targetLanguage: SummaryTargetLanguage;
  detailLevel: SummaryDetailLevel;
  status: SummaryRunStatus;
  error?: ShaleError;
  createdAt: string;
  completedAt?: string;
}

export interface SummaryResult {
  id: number;
  runId: number;
  entryId: number;
  targetLanguage: SummaryTargetLanguage;
  detailLevel: SummaryDetailLevel;
  content: string;
  inputMarkdownHash: string;
  promptVersion: string;
  createdAt: string;
  updatedAt: string;
}

export type SummaryState =
  | { state: 'idle' }
  | { state: 'running'; run: SummaryRun }
  | { state: 'failed'; run: SummaryRun }
  | {
      state: 'succeeded';
      result: SummaryResult;
      freshness: SummaryFreshness;
    };

export interface SummaryGetRequest {
  entryId: number;
  targetLanguage: SummaryTargetLanguage;
  detailLevel: SummaryDetailLevel;
}

export type SummaryGenerateRequest = SummaryGetRequest;

export interface SummaryGenerateResponse {
  runId: number;
  reused: boolean;
}

interface SummaryStreamEventBase {
  runId: number;
  entryId: number;
  targetLanguage: SummaryTargetLanguage;
  detailLevel: SummaryDetailLevel;
}

export type SummaryStreamEvent =
  | (SummaryStreamEventBase & { type: 'started' })
  | (SummaryStreamEventBase & { type: 'delta'; text: string })
  | (SummaryStreamEventBase & { type: 'completed'; result: SummaryResult })
  | (SummaryStreamEventBase & { type: 'failed'; error: ShaleError });
