import type { EntryQuery } from '../../../shared/contracts/feed.types';

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

export const normalizeSearchQuery = (query: string): string => query.trim();

/**
 * Search intentionally spans every persisted feed. When search is inactive,
 * the selected feed and list filter remain independent query dimensions.
 */
export const buildEntryQuery = ({
  selectedFeedId,
  filter,
  searchQuery,
  tagFilter,
  limit,
  cursor,
}: EntryQueryInput): EntryQuery => {
  const normalizedSearch = normalizeSearchQuery(searchQuery);
  const query: EntryQuery = { limit };

  if (cursor) query.cursor = cursor;

  if (normalizedSearch) {
    query.search = normalizedSearch;
    return query;
  }

  if (selectedFeedId !== null) query.feedId = selectedFeedId;
  if (filter === 'unread') query.isRead = false;
  if (filter === 'starred') query.isStarred = true;

  if (tagFilter) {
    query.tagNames = tagFilter.tagNames;
    query.matchAll = tagFilter.matchAll;
  }

  return query;
};
