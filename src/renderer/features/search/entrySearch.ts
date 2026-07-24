import type { EntryQuery } from '../../../shared/contracts/feed.types';

export type EntryFilter = 'all' | 'unread' | 'starred';

interface EntryQueryInput {
  selectedFeedId: number | null;
  filter: EntryFilter;
  searchQuery: string;
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

  return query;
};
