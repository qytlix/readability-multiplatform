export const DEFAULT_TRANSLATION_EXPERT_ID = 'none';
export const EXPERT_TEMPLATE_VARIABLES = [
  'sourceLanguage',
  'targetLanguage',
] as const;

export type TranslationExpertOrigin = 'builtin' | 'user';

export interface TranslationExpert {
  id: string;
  version: string;
  name: string;
  description: string;
  author: string;
  details: string;
  origin: TranslationExpertOrigin;
  instruction: string;
  contentHash: string;
  matches: string[];
  warnings: string[];
}

export interface TranslationExpertList {
  experts: TranslationExpert[];
}

export interface TranslationExpertImportPreview {
  valid: boolean;
  expert?: TranslationExpert;
  warnings: string[];
  errors: string[];
  ignoredFields: string[];
  replacesExistingUserExpert: boolean;
}

export interface TranslationExpertPreviewRequest {
  yaml: string;
}

export interface TranslationExpertImportRequest {
  yaml: string;
  replace?: boolean;
}

export interface TranslationExpertRemoveRequest {
  id: string;
}

export interface TranslationExpertMutationResult {
  expertId: string;
}

/** Generated build artifact shape; not exposed through IPC. */
export interface BuiltInExpertBundle {
  schemaVersion: 1;
  sourceRepository: string;
  sourceCommit: string;
  experts: Array<{
    id: string;
    version: string;
    name: string;
    description: string;
    author: string;
    details: string;
    matches: string[];
    instruction: string;
    sourceFile: string;
    sourceSha256: string;
    compiledSha256: string;
    warnings: string[];
  }>;
}
