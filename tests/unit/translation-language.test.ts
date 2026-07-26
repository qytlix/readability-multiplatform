import { describe, expect, it } from 'vitest';
import {
  hasTranslatableText,
  isLikelyAlreadyTargetLanguage,
  isTranslationOutputLanguageConsistent,
} from '../../src/main/ai/provider/TranslationLanguage';

describe('hasTranslatableText', () => {
  it('skips symbols, dividers, and number-only labels without altering their text', () => {
    expect(hasTranslatableText('✦ — ✦')).toBe(false);
    expect(hasTranslatableText('123 — 456')).toBe(false);
    expect(hasTranslatableText('😀')).toBe(false);
  });

  it('recognizes letters from multiple scripts as potentially translatable', () => {
    expect(hasTranslatableText('A short sentence.')).toBe(true);
    expect(hasTranslatableText('中文内容')).toBe(true);
    expect(hasTranslatableText('مرحبا')).toBe(true);
    expect(hasTranslatableText('Привет')).toBe(true);
  });
});

describe('isLikelyAlreadyTargetLanguage', () => {
  it('recognizes Simplified Chinese even when product names are Latin text', () => {
    expect(isLikelyAlreadyTargetLanguage(
      'UniGetUI：可能是 Windows 下最好用的应用商店',
      'zh-CN',
    )).toBe(true);
  });

  it('does not skip Traditional Chinese or Japanese when Simplified Chinese is requested', () => {
    expect(isLikelyAlreadyTargetLanguage('這是一篇軟體介紹文章。', 'zh-CN')).toBe(false);
    expect(isLikelyAlreadyTargetLanguage('如何使用軟體套件', 'zh-CN')).toBe(false);
    expect(isLikelyAlreadyTargetLanguage('这是一篇軟體介绍文章。', 'zh-CN')).toBe(false);
    expect(isLikelyAlreadyTargetLanguage('これは日本語の記事です。', 'zh-CN')).toBe(false);
  });

  it('recognizes a confidently English sentence but not arbitrary Latin-language text', () => {
    expect(isLikelyAlreadyTargetLanguage(
      'This article explains how the package manager works on Windows.',
      'en',
    )).toBe(true);
    expect(isLikelyAlreadyTargetLanguage(
      'Cet article explique le fonctionnement du gestionnaire de paquets.',
      'en',
    )).toBe(false);
  });

  it('preserves standalone web addresses without a provider call', () => {
    expect(isLikelyAlreadyTargetLanguage('https://example.com/article', 'zh-CN')).toBe(true);
    expect(isLikelyAlreadyTargetLanguage('https://example.com/article', 'en')).toBe(true);
  });
});

describe('isTranslationOutputLanguageConsistent', () => {
  it('rejects unrelated scripts and untranslated sentences for a Chinese target', () => {
    expect(isTranslationOutputLanguageConsistent(
      'Deadline指出，这起诉讼在加州法律下是否वास्तव可执行。',
      'zh-CN',
    )).toBe(false);
    expect(isTranslationOutputLanguageConsistent(
      'This entire sentence remains in the wrong target language.',
      'zh-CN',
    )).toBe(false);
  });

  it('allows product names, identifiers, and short protected-looking literals', () => {
    expect(isTranslationOutputLanguageConsistent(
      '启动 Shale 前请运行 npm ci。',
      'zh-CN',
    )).toBe(true);
    expect(isTranslationOutputLanguageConsistent(
      'slot-1 slot-2 slot-3 slot-4',
      'zh-CN',
    )).toBe(true);
  });

  it('distinguishes supported Latin target languages when the sentence is clear', () => {
    const french = 'Cet article explique le fonctionnement du gestionnaire de paquets.';
    expect(isTranslationOutputLanguageConsistent(french, 'fr')).toBe(true);
    expect(isTranslationOutputLanguageConsistent(french, 'en')).toBe(false);
  });
});
