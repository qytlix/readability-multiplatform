import { describe, expect, it } from 'vitest';
import {
  formatArticleDate,
  getArticleDateLocale,
} from '../../../src/renderer/features/feeds/articleMetadata';

describe('article metadata', () => {
  it('uses Chinese dates for Chinese articles', () => {
    expect(getArticleDateLocale('本地优先的阅读器')).toBe('zh-CN');
    expect(formatArticleDate('2026-07-23T12:00:00', 'zh-CN')).toBe('2026年7月23日');
  });

  it('uses English dates for English articles', () => {
    expect(getArticleDateLocale('A local-first feed reader')).toBe('en-US');
    expect(formatArticleDate('2026-07-23T12:00:00', 'en-US')).toBe('July 23, 2026');
  });

  it('falls back to article text when the title is language-neutral', () => {
    expect(getArticleDateLocale(
      'RSS 2.0',
      '这是一篇介绍本地优先阅读体验的中文文章。',
    )).toBe('zh-CN');
  });

  it('preserves an invalid source date instead of showing Invalid Date', () => {
    expect(formatArticleDate('not-a-date', 'en-US')).toBe('not-a-date');
  });
});
