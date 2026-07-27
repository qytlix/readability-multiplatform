import type { EntryQuery } from '../../../shared/contracts/feed.types';
import {
  normalizeSearchQuery,
  parseTagSearchQuery,
} from '../../../shared/search';

export { normalizeSearchQuery, parseTagSearchQuery } from '../../../shared/search';

export type EntryFilter = 'all' | 'unread' | 'starred';

export interface TagFilterState {
  tagNames: string[];
  matchAll: boolean;
}

interface EntryQueryInput {
  selectedFeedId: number | null;
  filter: EntryFilter;
  searchQuery: string;
  tagFilter?: TagFilterState | null;
  limit: number;
  cursor?: EntryQuery['cursor'];
}

export const buildEntryQuery = ({
  selectedFeedId,
  filter,
  searchQuery,
  tagFilter,
  limit,
  cursor,
}: EntryQueryInput): EntryQuery => {
  const normalizedSearch = normalizeSearchQuery(searchQuery);

  // Parse tag:... and tag:"..." terms from the search query
  const tagParsed = normalizedSearch
    ? parseTagSearchQuery(normalizedSearch)
    : { textQuery: '', tagFuzzyNames: [], tagExactNames: [] };
  const textQuery = tagParsed.textQuery || undefined;

  const query: EntryQuery = { limit };

  if (cursor) query.cursor = cursor;

  if (selectedFeedId !== null) query.feedId = selectedFeedId;
  if (filter === 'unread') query.isRead = false;
  if (filter === 'starred') query.isStarred = true;
  if (textQuery) query.search = textQuery;

  // Combine tag filter from sidebar with tag search from search box
  const combinedExact = new Set<string>();
  const combinedFuzzy = new Set<string>();

  if (tagFilter) {
    for (const name of tagFilter.tagNames) {
      combinedExact.add(name);
    }
    query.matchAll = tagFilter.matchAll;
  }

  for (const name of tagParsed.tagExactNames) {
    combinedExact.add(name);
  }
  for (const name of tagParsed.tagFuzzyNames) {
    combinedFuzzy.add(name);
  }

  if (combinedExact.size > 0) {
    query.tagNames = Array.from(combinedExact);
  }
  if (combinedFuzzy.size > 0) {
    query.tagFuzzyNames = Array.from(combinedFuzzy);
  }

  return query;
};
