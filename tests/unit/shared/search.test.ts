import { describe, expect, it } from 'vitest';
import {
  getPlainSearchText,
  normalizeSearchQuery,
  parseSearchTerms,
  parseTagSearchQuery,
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

describe('parseTagSearchQuery', () => {
  it('extracts fuzzy tag:keyword from query', () => {
    const result = parseTagSearchQuery('tag:tech database');
    expect(result).toEqual({
      textQuery: 'database',
      tagFuzzyNames: ['tech'],
      tagExactNames: [],
    });
  });

  it('extracts exact tag:"Exact Name" from query', () => {
    const result = parseTagSearchQuery('tag:"Machine Learning"');
    expect(result).toEqual({
      textQuery: '',
      tagFuzzyNames: [],
      tagExactNames: ['Machine Learning'],
    });
  });

  it('extracts multiple tag: terms', () => {
    const result = parseTagSearchQuery('tag:tech tag:News');
    expect(result).toEqual({
      textQuery: '',
      tagFuzzyNames: ['tech', 'News'],
      tagExactNames: [],
    });
  });

  it('handles mixed tag: and text terms', () => {
    const result = parseTagSearchQuery('tag:tech "SQLite migration"');
    expect(result).toEqual({
      textQuery: '"SQLite migration"',
      tagFuzzyNames: ['tech'],
      tagExactNames: [],
    });
  });

  it('handles mixed fuzzy and exact tag terms with text', () => {
    const result = parseTagSearchQuery('tag:tech tag:"AI News" database');
    expect(result).toEqual({
      textQuery: 'database',
      tagFuzzyNames: ['tech'],
      tagExactNames: ['AI News'],
    });
  });

  it('returns empty result for empty input', () => {
    const result = parseTagSearchQuery('');
    expect(result).toEqual({
      textQuery: '',
      tagFuzzyNames: [],
      tagExactNames: [],
    });
  });

  it('returns empty result for whitespace-only input', () => {
    const result = parseTagSearchQuery('   ');
    expect(result).toEqual({
      textQuery: '',
      tagFuzzyNames: [],
      tagExactNames: [],
    });
  });

  it('treats plain text without tag: prefix normally', () => {
    const result = parseTagSearchQuery('normal search text');
    expect(result).toEqual({
      textQuery: 'normal search text',
      tagFuzzyNames: [],
      tagExactNames: [],
    });
  });

  it('handles tag: at the end of query', () => {
    const result = parseTagSearchQuery('search tag:');
    expect(result).toEqual({
      textQuery: 'search',
      tagFuzzyNames: [],
      tagExactNames: [],
    });
  });

  it('preserves quoted text that is not a tag search', () => {
    const result = parseTagSearchQuery('"plain quoted" tag:tech');
    expect(result).toEqual({
      textQuery: '"plain quoted"',
      tagFuzzyNames: ['tech'],
      tagExactNames: [],
    });
  });
});
