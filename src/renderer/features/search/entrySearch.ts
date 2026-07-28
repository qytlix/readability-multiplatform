import type { EntryQuery } from '../../../shared/contracts/feed.types';
import {
  normalizeSearchQuery,
  parseSearchQuery,
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

  // Parse all field:... filters from the search query
  const parsed = normalizedSearch
    ? parseSearchQuery(normalizedSearch)
    : { textQuery: '', filters: [], tagAnyFuzzy: [], tagAnyExact: [] };
  const textQuery = parsed.textQuery || undefined;

  const query: EntryQuery = { limit };

  if (cursor) query.cursor = cursor;

  if (selectedFeedId !== null) query.feedId = selectedFeedId;
  if (filter === 'unread') query.isRead = false;
  if (filter === 'starred') query.isStarred = true;
  if (textQuery) query.search = textQuery;

  // Populate structured filters (backend will process these)
  if (parsed.filters.length > 0) {
    query.filters = parsed.filters;
  }

  // Combine tag filter from sidebar with tag search from search box
  // (backward compat via old tagNames/tagFuzzyNames fields)
  const combinedExact = new Set<string>();
  const combinedFuzzy = new Set<string>();

  if (tagFilter) {
    for (const name of tagFilter.tagNames) {
      combinedExact.add(name);
    }
    query.matchAll = tagFilter.matchAll;
  }

  for (const name of parsed.tagAnyExact) {
    combinedExact.add(name);
  }
  for (const name of parsed.tagAnyFuzzy) {
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
