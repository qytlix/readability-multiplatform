import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AI_PREFERENCES,
  loadAiPreferences,
  saveAiPreferences,
} from '../../src/renderer/features/settings/aiPreferences';

function createStorage(initialValue: string | null = null) {
  let value = initialValue;
  return {
    getItem: () => value,
    setItem: (_key: string, nextValue: string) => {
      value = nextValue;
    },
    read: () => value,
  };
}

describe('AI preferences', () => {
  it('uses defaults when no saved preferences exist', () => {
    expect(loadAiPreferences(createStorage())).toEqual(DEFAULT_AI_PREFERENCES);
  });

  it('keeps valid values and replaces invalid values with defaults', () => {
    const storage = createStorage(JSON.stringify({
      summaryTargetLanguage: 'en',
      summaryDetailLevel: 'unknown',
      translationTargetLanguage: 'en',
      inlineTranslationShortcut: {
        key: 'K',
        ctrlKey: true,
        altKey: false,
        shiftKey: true,
        metaKey: false,
      },
    }));

    expect(loadAiPreferences(storage)).toEqual({
      summaryTargetLanguage: 'en',
      summaryDetailLevel: 'medium',
      translationTargetLanguage: 'en',
      inlineTranslationShortcut: {
        key: 'K',
        ctrlKey: true,
        altKey: false,
        shiftKey: true,
        metaKey: false,
      },
    });
  });

  it('migrates the previous single-modifier setting to a valid chord', () => {
    const storage = createStorage(JSON.stringify({ inlineTranslationShortcut: 'Alt' }));

    expect(loadAiPreferences(storage).inlineTranslationShortcut).toEqual({
      key: 'Z',
      ctrlKey: false,
      altKey: true,
      shiftKey: false,
      metaKey: false,
    });
  });

  it('serializes preferences for the next app session', () => {
    const storage = createStorage();
    const preferences = {
      summaryTargetLanguage: 'en' as const,
      summaryDetailLevel: 'detailed' as const,
      translationTargetLanguage: 'zh-CN' as const,
      inlineTranslationShortcut: {
        key: 'T',
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        metaKey: false,
      },
    };

    saveAiPreferences(storage, preferences);

    expect(JSON.parse(storage.read() ?? '')).toEqual(preferences);
  });
});
