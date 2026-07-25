import type {
  SummaryDetailLevel,
  SummaryTargetLanguage,
} from '../../../shared/contracts/summary.types';
import type {
  TranslationSourceLanguage,
  TranslationTargetLanguage,
} from '../../../shared/contracts/translation.types';
import {
  TRANSLATION_SOURCE_LANGUAGES,
  TRANSLATION_TARGET_LANGUAGES,
} from '../../../shared/contracts/translation.types';
import { DEFAULT_TRANSLATION_EXPERT_ID } from '../../../shared/contracts/translation-expert.types';
import {
  areKeyboardShortcutsEqual,
  DEFAULT_FULL_TRANSLATION_SHORTCUT,
  DEFAULT_PARAGRAPH_TRANSLATION_SHORTCUT,
  DEFAULT_SELECTION_TRANSLATION_SHORTCUT,
  parseStoredKeyboardShortcut,
  type TranslationShortcut,
} from './keyboardShortcut';

export interface AiPreferences {
  summaryTargetLanguage: SummaryTargetLanguage;
  summaryDetailLevel: SummaryDetailLevel;
  translationSourceLanguage: TranslationSourceLanguage;
  translationTargetLanguage: TranslationTargetLanguage;
  useTerminology: boolean;
  useSmartContext: boolean;
  translationExpertId: string;
  fullTranslationShortcut: TranslationShortcut;
  paragraphTranslationShortcut: TranslationShortcut;
  selectionTranslationShortcut: TranslationShortcut;
}

export const DEFAULT_AI_PREFERENCES: AiPreferences = {
  summaryTargetLanguage: 'zh-CN',
  summaryDetailLevel: 'medium',
  translationSourceLanguage: 'auto',
  translationTargetLanguage: 'zh-CN',
  useTerminology: true,
  useSmartContext: false,
  translationExpertId: DEFAULT_TRANSLATION_EXPERT_ID,
  fullTranslationShortcut: DEFAULT_FULL_TRANSLATION_SHORTCUT,
  paragraphTranslationShortcut: DEFAULT_PARAGRAPH_TRANSLATION_SHORTCUT,
  selectionTranslationShortcut: DEFAULT_SELECTION_TRANSLATION_SHORTCUT,
};

const STORAGE_KEY = 'shale.aiPreferences';
const SUMMARY_LANGUAGES: ReadonlyArray<SummaryTargetLanguage> = ['zh-CN', 'en'];
const DETAIL_LEVELS: ReadonlyArray<SummaryDetailLevel> = ['short', 'medium', 'detailed'];

interface PreferenceStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function loadAiPreferences(storage: PreferenceStorage): AiPreferences {
  try {
    const stored = storage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_AI_PREFERENCES;
    const candidate = JSON.parse(stored) as Partial<AiPreferences> & {
      inlineTranslationShortcut?: unknown;
    };
    const legacyInlineShortcut = parseStoredKeyboardShortcut(
      candidate.inlineTranslationShortcut,
    );
    const usedShortcuts: TranslationShortcut[] = [];
    const paragraphTranslationShortcut = selectUniqueShortcut(
      [
        parseStoredKeyboardShortcut(candidate.paragraphTranslationShortcut),
        legacyInlineShortcut,
        DEFAULT_PARAGRAPH_TRANSLATION_SHORTCUT,
        DEFAULT_FULL_TRANSLATION_SHORTCUT,
        DEFAULT_SELECTION_TRANSLATION_SHORTCUT,
      ],
      usedShortcuts,
    );
    const fullTranslationShortcut = selectUniqueShortcut(
      [
        parseStoredKeyboardShortcut(candidate.fullTranslationShortcut),
        DEFAULT_FULL_TRANSLATION_SHORTCUT,
        DEFAULT_SELECTION_TRANSLATION_SHORTCUT,
        DEFAULT_PARAGRAPH_TRANSLATION_SHORTCUT,
      ],
      usedShortcuts,
    );
    const selectionTranslationShortcut = selectUniqueShortcut(
      [
        parseStoredKeyboardShortcut(candidate.selectionTranslationShortcut),
        DEFAULT_SELECTION_TRANSLATION_SHORTCUT,
        DEFAULT_FULL_TRANSLATION_SHORTCUT,
        DEFAULT_PARAGRAPH_TRANSLATION_SHORTCUT,
      ],
      usedShortcuts,
    );
    return {
      summaryTargetLanguage: SUMMARY_LANGUAGES.includes(candidate.summaryTargetLanguage as SummaryTargetLanguage)
        ? candidate.summaryTargetLanguage as SummaryTargetLanguage
        : DEFAULT_AI_PREFERENCES.summaryTargetLanguage,
      summaryDetailLevel: DETAIL_LEVELS.includes(candidate.summaryDetailLevel as SummaryDetailLevel)
        ? candidate.summaryDetailLevel as SummaryDetailLevel
        : DEFAULT_AI_PREFERENCES.summaryDetailLevel,
      translationSourceLanguage: TRANSLATION_SOURCE_LANGUAGES.includes(
        candidate.translationSourceLanguage as TranslationSourceLanguage,
      )
        ? candidate.translationSourceLanguage as TranslationSourceLanguage
        : DEFAULT_AI_PREFERENCES.translationSourceLanguage,
      translationTargetLanguage: TRANSLATION_TARGET_LANGUAGES.includes(candidate.translationTargetLanguage as TranslationTargetLanguage)
        ? candidate.translationTargetLanguage as TranslationTargetLanguage
        : DEFAULT_AI_PREFERENCES.translationTargetLanguage,
      useTerminology: candidate.useTerminology !== false,
      useSmartContext: candidate.useSmartContext === true,
      translationExpertId: typeof candidate.translationExpertId === 'string'
        && candidate.translationExpertId.length > 0
        && candidate.translationExpertId.length <= 64
        ? candidate.translationExpertId
        : DEFAULT_AI_PREFERENCES.translationExpertId,
      fullTranslationShortcut,
      paragraphTranslationShortcut,
      selectionTranslationShortcut,
    };
  } catch {
    return DEFAULT_AI_PREFERENCES;
  }
}

function selectUniqueShortcut(
  candidates: Array<TranslationShortcut | null>,
  usedShortcuts: TranslationShortcut[],
): TranslationShortcut {
  const shortcut = candidates.find((candidate): candidate is TranslationShortcut =>
    candidate !== null
    && !usedShortcuts.some((used) => areKeyboardShortcutsEqual(used, candidate)));
  if (!shortcut) {
    throw new Error('Unable to assign distinct Translation shortcuts.');
  }
  usedShortcuts.push(shortcut);
  return shortcut;
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
