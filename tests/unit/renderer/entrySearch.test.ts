import { describe, expect, it } from 'vitest';
import {
  buildEntryQuery,
  normalizeSearchQuery,
} from '../../../src/renderer/features/search/entrySearch';

describe('entry search query', () => {
  it('trims the search query', () => {
    expect(normalizeSearchQuery('  local first  ')).toBe('local first');
  });

  it('searches every feed and ignores the browsing filter', () => {
    expect(buildEntryQuery({
      selectedFeedId: 42,
      filter: 'starred',
      searchQuery: ' design ',
      limit: 30,
    })).toEqual({
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
});
