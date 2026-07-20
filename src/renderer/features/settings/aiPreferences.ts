import type {
  SummaryDetailLevel,
  SummaryTargetLanguage,
} from '../../../shared/contracts/summary.types';
import type { TranslationTargetLanguage } from '../../../shared/contracts/translation.types';
import {
  DEFAULT_INLINE_TRANSLATION_SHORTCUT,
  parseStoredKeyboardShortcut,
  type InlineTranslationShortcut,
} from './keyboardShortcut';

export interface AiPreferences {
  summaryTargetLanguage: SummaryTargetLanguage;
  summaryDetailLevel: SummaryDetailLevel;
  translationTargetLanguage: TranslationTargetLanguage;
  inlineTranslationShortcut: InlineTranslationShortcut;
}

export const DEFAULT_AI_PREFERENCES: AiPreferences = {
  summaryTargetLanguage: 'zh-CN',
  summaryDetailLevel: 'medium',
  translationTargetLanguage: 'zh-CN',
  inlineTranslationShortcut: DEFAULT_INLINE_TRANSLATION_SHORTCUT,
};

const STORAGE_KEY = 'shale.aiPreferences';
const LANGUAGES: ReadonlyArray<SummaryTargetLanguage> = ['zh-CN', 'en'];
const DETAIL_LEVELS: ReadonlyArray<SummaryDetailLevel> = ['short', 'medium', 'detailed'];

interface PreferenceStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function loadAiPreferences(storage: PreferenceStorage): AiPreferences {
  try {
    const stored = storage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_AI_PREFERENCES;
    const candidate = JSON.parse(stored) as Partial<AiPreferences>;
    return {
      summaryTargetLanguage: LANGUAGES.includes(candidate.summaryTargetLanguage as SummaryTargetLanguage)
        ? candidate.summaryTargetLanguage as SummaryTargetLanguage
        : DEFAULT_AI_PREFERENCES.summaryTargetLanguage,
      summaryDetailLevel: DETAIL_LEVELS.includes(candidate.summaryDetailLevel as SummaryDetailLevel)
        ? candidate.summaryDetailLevel as SummaryDetailLevel
        : DEFAULT_AI_PREFERENCES.summaryDetailLevel,
      translationTargetLanguage: LANGUAGES.includes(candidate.translationTargetLanguage as TranslationTargetLanguage)
        ? candidate.translationTargetLanguage as TranslationTargetLanguage
        : DEFAULT_AI_PREFERENCES.translationTargetLanguage,
      inlineTranslationShortcut: parseStoredKeyboardShortcut(candidate.inlineTranslationShortcut)
        ?? DEFAULT_AI_PREFERENCES.inlineTranslationShortcut,
    };
  } catch {
    return DEFAULT_AI_PREFERENCES;
  }
}

export function saveAiPreferences(
  storage: PreferenceStorage,
  preferences: AiPreferences,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // The current session can still use the selected preferences when storage is unavailable.
  }
}
