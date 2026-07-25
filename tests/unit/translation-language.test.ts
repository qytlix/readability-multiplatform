import { describe, expect, it } from 'vitest';
import {
  hasTranslatableText,
  isLikelyAlreadyTargetLanguage,
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
