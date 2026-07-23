import { describe, expect, it } from 'vitest';
import { isLikelyAlreadyTargetLanguage } from '../../src/main/ai/provider/TranslationLanguage';

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
