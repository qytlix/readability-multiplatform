import type { TranslationTargetLanguage } from './translation.types';

export const DEFAULT_TERMINOLOGY_LIBRARY_ID = 'builtin:default';

export type TerminologyLibraryOrigin = 'builtin' | 'user';
export type TerminologyEntryTargetLanguage =
  | TranslationTargetLanguage
  | 'zh-TW';

export interface TerminologyLibrary {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  origin: TerminologyLibraryOrigin;
  enabled: boolean;
  orderIndex: number;
  entryCount: number;
  contentHash: string;
  availableTargetLanguages: Array<
    TranslationTargetLanguage | 'all' | 'zh-TW'
  >;
  /**
   * True when Traditional Chinese entries come from an upstream zh-TW
   * glossary and are only a low-priority reference for zh-HK.
   */
  usesTraditionalChineseFallback: boolean;
  removable: boolean;
}

export interface TerminologyLibraryList {
  libraries: TerminologyLibrary[];
  enabledSetHash: string;
}

export interface TerminologyLibrarySetEnabledRequest {
  id: string;
  enabled: boolean;
}

export interface TerminologyLibraryMutationResult {
  libraryId: string;
  enabledSetHash: string;
}

export interface TerminologyCsvIssue {
  line: number;
  code:
    | 'INVALID_HEADER'
    | 'MALFORMED_CSV'
    | 'EMPTY_SOURCE'
    | 'INVALID_TARGET_LANGUAGE'
    | 'FIELD_TOO_LONG'
    | 'DUPLICATE'
    | 'CONFLICT';
  message: string;
}

export interface TerminologyImportPreviewEntry {
  line: number;
  source: string;
  target?: string;
  targetLanguage?: TranslationTargetLanguage;
}

export interface TerminologyImportPreview {
  valid: boolean;
  name: string;
  acceptedRowCount: number;
  entries: TerminologyImportPreviewEntry[];
  errors: TerminologyCsvIssue[];
  warnings: TerminologyCsvIssue[];
  replacesExistingUserLibrary: boolean;
  existingLibraryId?: string;
  contentHash?: string;
}

export interface TerminologyImportPreviewRequest {
  name: string;
  csv: string;
}

export interface TerminologyImportRequest
  extends TerminologyImportPreviewRequest {
  replace?: boolean;
}

export interface TerminologyLibraryRemoveRequest {
  id: string;
}
