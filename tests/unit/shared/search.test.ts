import { describe, expect, it } from 'vitest';
import {
  getPlainSearchText,
  normalizeSearchQuery,
  parseSearchTerms,
  requiresShortSearchFallback,
  toFts5Query,
} from '../../../src/shared/search';

describe('shared search query parsing', () => {
  it('normalizes Unicode compatibility forms and whitespace', () => {
    expect(normalizeSearchQuery('  ＳＱＬｉｔｅ\n  ﬁle ')).toBe('SQLite file');
  });

  it('preserves quoted phrases and treats operators as plain terms', () => {
    const terms = parseSearchTerms('"local search" AND migration');
    expect(terms).toEqual([
      { value: 'local search', isPhrase: true },
      { value: 'AND', isPhrase: false },
      { value: 'migration', isPhrase: false },
    ]);
    expect(getPlainSearchText(terms)).toBe('local search AND migration');
    expect(toFts5Query(terms)).toBe(
      '"local search" AND "AND" AND "migration"',
    );
  });

  it('uses the short-query fallback if any term is under three characters', () => {
    expect(requiresShortSearchFallback(parseSearchTerms('AI database'))).toBe(true);
    expect(requiresShortSearchFallback(parseSearchTerms('数据库'))).toBe(false);
  });
});
