import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLikelyAlreadyTargetLanguage } from '../../src/main/ai/provider/TranslationLanguage';
import {
  TRANSLATION_LANGUAGE_LABELS,
  TRANSLATION_SOURCE_LANGUAGES,
  TRANSLATION_TARGET_LANGUAGES,
  type TranslationTargetLanguage,
} from '../../src/shared/contracts/translation.types';

describe('multilingual Translation contract and fixtures', () => {
  it('exposes auto plus exactly eight supported article languages', () => {
    expect(TRANSLATION_TARGET_LANGUAGES).toEqual([
      'zh-CN',
      'zh-HK',
      'ja',
      'ko',
      'de',
      'fr',
      'es',
      'en',
    ]);
    expect(TRANSLATION_SOURCE_LANGUAGES).toEqual([
      'auto',
      ...TRANSLATION_TARGET_LANGUAGES,
    ]);
    expect(TRANSLATION_LANGUAGE_LABELS['zh-HK']).toContain('Hong Kong');
    expect(TRANSLATION_SOURCE_LANGUAGES).not.toContain('zh-TW');
  });

  it.each([
    ['zh-CN', true],
    ['zh-HK', false],
    ['ja', true],
    ['ko', true],
    ['de', true],
    ['fr', true],
    ['es', true],
    ['en', true],
  ] as const)(
    'loads the %s article fixture and applies its conservative skip rule',
    (language, expectedSkip) => {
      const text = fixtureText(language);
      expect(text.length).toBeGreaterThan(30);
      expect(isLikelyAlreadyTargetLanguage(text, language)).toBe(expectedSkip);
    },
  );

  it('does not confuse Latin-language fixtures with English', () => {
    for (const language of ['de', 'fr', 'es'] as const) {
      expect(isLikelyAlreadyTargetLanguage(fixtureText(language), 'en')).toBe(false);
    }
  });
});

function fixtureText(language: TranslationTargetLanguage): string {
  const html = readFileSync(
    path.resolve('tests', 'fixtures', 'translation', `translation-${language}.html`),
    'utf8',
  );
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
