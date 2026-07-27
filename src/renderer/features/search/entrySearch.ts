import type { EntryQuery } from '../../../shared/contracts/feed.types';
import { normalizeSearchQuery } from '../../../shared/search';

export { normalizeSearchQuery } from '../../../shared/search';

export type EntryFilter = 'all' | 'unread' | 'starred';

interface EntryQueryInput {
  selectedFeedId: number | null;
  filter: EntryFilter;
  searchQuery: string;
  limit: number;
  cursor?: EntryQuery['cursor'];
}

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

  if (selectedFeedId !== null) query.feedId = selectedFeedId;
  if (filter === 'unread') query.isRead = false;
  if (filter === 'starred') query.isStarred = true;
  if (normalizedSearch) query.search = normalizedSearch;

  return query;
};
