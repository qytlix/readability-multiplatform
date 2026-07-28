import type { EntryQuery } from '../../../shared/contracts/feed.types';
import { normalizeSearchQuery, parseSearchQuery } from '../../../shared/search';

export { normalizeSearchQuery } from '../../../shared/search';

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

const toStructuredTagFilters = (
  tagFilter: TagFilterState | null | undefined,
): import('../../../shared/search').SearchFilter[] | undefined => {
  if (!tagFilter || tagFilter.tagNames.length === 0) return undefined;
  return tagFilter.tagNames.map((name) => ({
    field: 'tag' as const,
    operator: (tagFilter.matchAll ? '+' : '') as '+' | '-' | '',
    value: name,
    match: 'exact' as const,
  }));
};

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
    : { textQuery: '', filters: [] };
  const textQuery = parsed.textQuery || undefined;

  const query: EntryQuery = { limit };

  if (cursor) query.cursor = cursor;

  if (selectedFeedId !== null) query.feedId = selectedFeedId;
  if (filter === 'unread') query.isRead = false;
  if (filter === 'starred') query.isStarred = true;
  if (textQuery) query.search = textQuery;

  // Merge sidebar tagFilter filters with search box filters
  const sidebarFilters = toStructuredTagFilters(tagFilter);
  const allFilters = [
    ...(parsed.filters.length > 0 ? parsed.filters : []),
    ...(sidebarFilters ?? []),
  ];
  if (allFilters.length > 0) {
    query.filters = allFilters;
  }

  return query;
};