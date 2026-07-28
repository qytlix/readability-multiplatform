import { describe, expect, it } from 'vitest';
import {
  getPlainSearchText,
  normalizeSearchQuery,
  parseSearchQuery,
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

describe('parseSearchQuery', () => {
  // ── Basic field filters ────────────────────────────────

  it('extracts tag: filter (fuzzy) from query', () => {
    const result = parseSearchQuery('tag:tech database');
    expect(result.textQuery).toBe('database');
    expect(result.filters).toEqual([
      { field: 'tag', operator: '', value: 'tech', match: 'fuzzy' },
    ]);
  });

  it('extracts tag= filter (exact) from query', () => {
    const result = parseSearchQuery('tag=tech database');
    expect(result.textQuery).toBe('database');
    expect(result.filters).toEqual([
      { field: 'tag', operator: '', value: 'tech', match: 'exact' },
    ]);
  });

  it('extracts +tag= (exact, AND) from query', () => {
    const result = parseSearchQuery('+tag=AI');
    expect(result.filters).toEqual([
      { field: 'tag', operator: '+', value: 'AI', match: 'exact' },
    ]);
  });

  it('extracts feed: filter from query', () => {
    const result = parseSearchQuery('feed:nytimes');
    expect(result.textQuery).toBe('');
    expect(result.filters).toEqual([
      { field: 'feed', operator: '', value: 'nytimes' },
    ]);
  });

  it('extracts title: filter from query', () => {
    const result = parseSearchQuery('title:climate hello');
    expect(result.textQuery).toBe('hello');
    expect(result.filters).toEqual([
      { field: 'title', operator: '', value: 'climate' },
    ]);
  });

  it('extracts content: filter from query', () => {
    const result = parseSearchQuery('content:"machine learning"');
    expect(result.textQuery).toBe('');
    expect(result.filters).toEqual([
      { field: 'content', operator: '', value: 'machine learning' },
    ]);
  });

  it('extracts author: filter from query', () => {
    const result = parseSearchQuery('author:"John Doe"');
    expect(result.textQuery).toBe('');
    expect(result.filters).toEqual([
      { field: 'author', operator: '', value: 'John Doe' },
    ]);
  });

  it('extracts starred: filter from query', () => {
    const result = parseSearchQuery('starred:yes');
    expect(result.textQuery).toBe('');
    expect(result.filters).toEqual([
      { field: 'starred', operator: '', value: 'yes' },
    ]);
  });

  it('extracts read: filter from query', () => {
    const result = parseSearchQuery('read:no');
    expect(result.textQuery).toBe('');
    expect(result.filters).toEqual([
      { field: 'read', operator: '', value: 'no' },
    ]);
  });

  // ── +/- operators ──────────────────────────────────────

  it('extracts +tag: (AND, fuzzy) filter', () => {
    const result = parseSearchQuery('+tag:AI');
    expect(result.filters).toEqual([
      { field: 'tag', operator: '+', value: 'AI', match: 'fuzzy' },
    ]);
  });

  it('extracts -tag: (exclusion, fuzzy) filter', () => {
    const result = parseSearchQuery('-tag:news');
    expect(result.filters).toEqual([
      { field: 'tag', operator: '-', value: 'news', match: 'fuzzy' },
    ]);
  });

  it('extracts +/- operators for non-tag fields', () => {
    const result = parseSearchQuery('+feed:NYT -title:obama');
    expect(result.filters).toEqual([
      { field: 'feed', operator: '+', value: 'NYT' },
      { field: 'title', operator: '-', value: 'obama' },
    ]);
  });

  it('extracts +field:"quoted" filter', () => {
    const result = parseSearchQuery('+author:"John Doe"');
    expect(result.filters).toEqual([
      { field: 'author', operator: '+', value: 'John Doe' },
    ]);
  });

  it('extracts -feed:"quoted" filter', () => {
    const result = parseSearchQuery('-feed:"Tech News"');
    expect(result.filters).toEqual([
      { field: 'feed', operator: '-', value: 'Tech News' },
    ]);
  });

  // ── tag= exact with quotes ─────────────────────────────

  it('extracts tag="quoted" (exact)', () => {
    const result = parseSearchQuery('tag="Machine Learning"');
    expect(result.filters).toEqual([
      { field: 'tag', operator: '', value: 'Machine Learning', match: 'exact' },
    ]);
  });

  it('extracts tag:"quoted" (fuzzy)', () => {
    const result = parseSearchQuery('tag:"AI News" database');
    expect(result.filters).toEqual([
      { field: 'tag', operator: '', value: 'AI News', match: 'fuzzy' },
    ]);
    expect(result.textQuery).toBe('database');
  });

  it('extracts +tag="quoted" (exact, AND)', () => {
    const result = parseSearchQuery('+tag="Exact Match"');
    expect(result.filters).toEqual([
      { field: 'tag', operator: '+', value: 'Exact Match', match: 'exact' },
    ]);
  });

  // ── Multiple filters mixed ─────────────────────────────

  it('handles multiple tag: terms (OR, fuzzy)', () => {
    const result = parseSearchQuery('tag:tech tag:News');
    expect(result.filters).toEqual([
      { field: 'tag', operator: '', value: 'tech', match: 'fuzzy' },
      { field: 'tag', operator: '', value: 'News', match: 'fuzzy' },
    ]);
    expect(result.textQuery).toBe('');
  });

  it('mixes +tag:, -tag:, tag: and plain text', () => {
    const result = parseSearchQuery('+tag:AI -tag:news tag:tech machine learning');
    expect(result.filters).toEqual([
      { field: 'tag', operator: '+', value: 'AI', match: 'fuzzy' },
      { field: 'tag', operator: '-', value: 'news', match: 'fuzzy' },
      { field: 'tag', operator: '', value: 'tech', match: 'fuzzy' },
    ]);
    expect(result.textQuery).toBe('machine learning');
  });

  it('mixes tag=, tag:, +/- operators', () => {
    const result = parseSearchQuery('tag=exact tag:fuzzy +tag=must -tag=exclude');
    expect(result.filters).toEqual([
      { field: 'tag', operator: '', value: 'exact', match: 'exact' },
      { field: 'tag', operator: '', value: 'fuzzy', match: 'fuzzy' },
      { field: 'tag', operator: '+', value: 'must', match: 'exact' },
      { field: 'tag', operator: '-', value: 'exclude', match: 'exact' },
    ]);
  });

  it('mixes different field filters with plain text', () => {
    const result = parseSearchQuery('tag:tech feed:NYT title:climate author:"John Doe" starred:yes hello');
    expect(result.filters).toEqual([
      { field: 'tag', operator: '', value: 'tech', match: 'fuzzy' },
      { field: 'feed', operator: '', value: 'NYT' },
      { field: 'title', operator: '', value: 'climate' },
      { field: 'author', operator: '', value: 'John Doe' },
      { field: 'starred', operator: '', value: 'yes' },
    ]);
    expect(result.textQuery).toBe('hello');
  });

  // ── Unknown / boundary / edge cases ────────────────────

  it('returns empty result for empty input', () => {
    const result = parseSearchQuery('');
    expect(result).toEqual({
      textQuery: '', filters: [],
    });
  });

  it('returns empty result for whitespace-only input', () => {
    const result = parseSearchQuery('   ');
    expect(result).toEqual({
      textQuery: '', filters: [],
    });
  });

  it('treats plain text without filter prefix normally', () => {
    const result = parseSearchQuery('normal search text');
    expect(result.textQuery).toBe('normal search text');
    expect(result.filters).toEqual([]);
  });

  it('silently drops dangling filter prefix (tag:)', () => {
    const result = parseSearchQuery('search tag:');
    expect(result.textQuery).toBe('search');
    expect(result.filters).toEqual([]);
  });

  it('silently drops dangling tag= prefix', () => {
    const result = parseSearchQuery('hello tag=');
    expect(result.textQuery).toBe('hello');
    expect(result.filters).toEqual([]);
  });

  it('silently drops dangling +feed: prefix', () => {
    const result = parseSearchQuery('hello +feed:');
    expect(result.textQuery).toBe('hello');
    expect(result.filters).toEqual([]);
  });

  it('treats unknown field prefix as plain text', () => {
    const result = parseSearchQuery('unknown:value test');
    expect(result.textQuery).toBe('unknown:value test');
    expect(result.filters).toEqual([]);
  });

  it('treats a quoted unknown field prefix as plain text', () => {
    const result = parseSearchQuery('unknown:"quoted value" test');
    expect(result.textQuery).toBe('unknown:"quoted value" test');
    expect(result.filters).toEqual([]);
  });

  it('preserves quoted text that is not a filter', () => {
    const result = parseSearchQuery('"plain quoted" tag:tech');
    expect(result.textQuery).toBe('"plain quoted"');
    expect(result.filters).toEqual([
      { field: 'tag', operator: '', value: 'tech', match: 'fuzzy' },
    ]);
  });

  it('handles quoted text before a filter prefix', () => {
    const result = parseSearchQuery('"some phrase" +feed:NYT');
    expect(result.textQuery).toBe('"some phrase"');
    expect(result.filters).toEqual([
      { field: 'feed', operator: '+', value: 'NYT' },
    ]);
  });

  it('handles unterminated quote as plain text', () => {
    const result = parseSearchQuery('tag:tech "unclosed');
    expect(result.textQuery).toBe('"unclosed"');
    expect(result.filters).toEqual([
      { field: 'tag', operator: '', value: 'tech', match: 'fuzzy' },
    ]);
  });

  it('handles unterminated quote after filter prefix', () => {
    const result = parseSearchQuery('+tag:"unclosed');
    // Unterminated quoted filter prefix goes to textQuery preserving the prefix
    expect(result.textQuery).toBe('"+tag:unclosed"');
    expect(result.filters).toEqual([]);
  });

  it('handles unterminated quote after tag= prefix', () => {
    const result = parseSearchQuery('tag="unclosed');
    expect(result.textQuery).toBe('"tag=unclosed"');
    expect(result.filters).toEqual([]);
  });

  it('handles starred:0 and starred:1', () => {
    expect(parseSearchQuery('starred:1').filters).toEqual([
      { field: 'starred', operator: '', value: '1' },
    ]);
    expect(parseSearchQuery('starred:0').filters).toEqual([
      { field: 'starred', operator: '', value: '0' },
    ]);
  });

  it('handles read:yes', () => {
    expect(parseSearchQuery('read:yes').filters).toEqual([
      { field: 'read', operator: '', value: 'yes' },
    ]);
  });

  it('handles field:value with colon in value (e.g. URL)', () => {
    // (.+)$ is greedy, so content:http://example.com → value = "http://example.com"
    const result = parseSearchQuery('content:http://example.com');
    expect(result.filters).toEqual([
      { field: 'content', operator: '', value: 'http://example.com' },
    ]);
  });
});
