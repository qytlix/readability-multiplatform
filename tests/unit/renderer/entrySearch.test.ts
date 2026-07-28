import { describe, expect, it } from 'vitest';
import {
  buildEntryQuery,
  normalizeSearchQuery,
} from '../../../src/renderer/features/search/entrySearch';

describe('entry search query', () => {
  it('normalizes compatibility characters and whitespace', () => {
    expect(normalizeSearchQuery('  local   ﬁrst  ')).toBe('local first');
  });

  it('keeps the current feed and browsing filter while searching', () => {
    expect(buildEntryQuery({
      selectedFeedId: 42,
      filter: 'starred',
      searchQuery: ' design ',
      limit: 30,
    })).toEqual({
      feedId: 42,
      isStarred: true,
      search: 'design',
      limit: 30,
    });
  });

  it('combines feed and unread filters while browsing', () => {
    expect(buildEntryQuery({
      selectedFeedId: 7,
      filter: 'unread',
      searchQuery: '',
      limit: 30,
      cursor: { publishedAt: '2026-07-23T00:00:00.000Z', id: 9 },
    })).toEqual({
      feedId: 7,
      isRead: false,
      limit: 30,
      cursor: { publishedAt: '2026-07-23T00:00:00.000Z', id: 9 },
    });
  });

  it('populates filters from tag: (fuzzy) search terms', () => {
    const result = buildEntryQuery({
      selectedFeedId: null,
      filter: 'all',
      searchQuery: 'tag:tech tag:"AI News" database',
      limit: 30,
    });
    expect(result.search).toBe('database');
    expect(result.filters).toEqual([
      { field: 'tag', operator: '', value: 'tech', match: 'fuzzy' },
      { field: 'tag', operator: '', value: 'AI News', match: 'fuzzy' },
    ]);
  });

  it('populates filters from tag= (exact) search terms', () => {
    const result = buildEntryQuery({
      selectedFeedId: null,
      filter: 'all',
      searchQuery: 'tag=tech tag="AI News" database',
      limit: 30,
    });
    expect(result.search).toBe('database');
    expect(result.filters).toEqual([
      { field: 'tag', operator: '', value: 'tech', match: 'exact' },
      { field: 'tag', operator: '', value: 'AI News', match: 'exact' },
    ]);
  });

  it('populates filters from +/-/field: search terms', () => {
    const result = buildEntryQuery({
      selectedFeedId: null,
      filter: 'all',
      searchQuery: '+tag:AI -tag:news feed:NYT title:climate starred:yes',
      limit: 30,
    });
    expect(result.search).toBeUndefined();
    expect(result.filters).toEqual([
      { field: 'tag', operator: '+', value: 'AI', match: 'fuzzy' },
      { field: 'tag', operator: '-', value: 'news', match: 'fuzzy' },
      { field: 'feed', operator: '', value: 'NYT' },
      { field: 'title', operator: '', value: 'climate' },
      { field: 'starred', operator: '', value: 'yes' },
    ]);
  });

  it('combines sidebar tagFilter with search box filters', () => {
    const result = buildEntryQuery({
      selectedFeedId: null,
      filter: 'all',
      searchQuery: 'tag:tech',
      tagFilter: { tagNames: ['sidebar-tag'], matchAll: true },
      limit: 30,
    });
    expect(result.filters).toEqual([
      { field: 'tag', operator: '', value: 'tech', match: 'fuzzy' },
      { field: 'tag', operator: '+', value: 'sidebar-tag', match: 'exact' },
    ]);
  });

  it('combines sidebar tagFilter (OR) with search box', () => {
    const result = buildEntryQuery({
      selectedFeedId: null,
      filter: 'all',
      searchQuery: 'tag:tech',
      tagFilter: { tagNames: ['sidebar-tag'], matchAll: false },
      limit: 30,
    });
    expect(result.filters).toEqual([
      { field: 'tag', operator: '', value: 'tech', match: 'fuzzy' },
      { field: 'tag', operator: '', value: 'sidebar-tag', match: 'exact' },
    ]);
  });
});