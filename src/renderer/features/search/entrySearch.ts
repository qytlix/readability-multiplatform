import type { EntryQuery } from '../../../shared/contracts/feed.types';
import { normalizeSearchQuery } from '../../../shared/search';

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

  if (selectedFeedId !== null) query.feedId = selectedFeedId;
  if (filter === 'unread') query.isRead = false;
  if (filter === 'starred') query.isStarred = true;
  if (normalizedSearch) query.search = normalizedSearch;

  if (tagFilter) {
    query.tagNames = tagFilter.tagNames;
    query.matchAll = tagFilter.matchAll;
  }

  return query;
};
