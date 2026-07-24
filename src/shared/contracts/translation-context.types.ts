import type {
  TranslationSourceLanguage,
  TranslationTargetLanguage,
} from './translation.types';

export const TRANSLATION_CONTEXT_SCHEMA_VERSION = 1;
export const TRANSLATION_CONTEXT_PROMPT_VERSION = 'translation-context-v2';

export interface TranslationContextKeyTerm {
  source: string;
  suggestedTarget?: string;
  meaning?: string;
}

export interface TranslationContext {
  schemaVersion: typeof TRANSLATION_CONTEXT_SCHEMA_VERSION;
  detectedSourceLanguage?: Exclude<TranslationSourceLanguage, 'auto'>;
  theme: string;
  keyTerms: TranslationContextKeyTerm[];
  styleGuide: string[];
}

export interface TranslationContextIdentity {
  sourceContentHash: string;
  sourceLanguage: TranslationSourceLanguage;
  targetLanguage: TranslationTargetLanguage;
  providerProfileId: number;
  providerModel: string;
  expertId: string;
  expertContentHash: string;
  promptVersion: typeof TRANSLATION_CONTEXT_PROMPT_VERSION;
}
