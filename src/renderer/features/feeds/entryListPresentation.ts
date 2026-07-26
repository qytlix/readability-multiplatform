import type { EntryFilter } from '../search/entrySearch';

export const entryListCopy = {
  allArticles: '全部文章',
  unreadArticles: '未读文章',
  starredArticles: '收藏文章',
  searchResults: '搜索结果',
  filterArticles: '筛选文章',
} as const;

interface EntryListHeadingInput {
  feedName: string | null;
  filter: EntryFilter;
  hasActiveSearch: boolean;
}

const getFilterHeading = (filter: EntryFilter): string => {
  if (filter === 'unread') return entryListCopy.unreadArticles;
  if (filter === 'starred') return entryListCopy.starredArticles;
  return entryListCopy.allArticles;
};

export const getEntryListHeading = ({
  feedName,
  filter,
  hasActiveSearch,
}: EntryListHeadingInput): string => {
  if (hasActiveSearch) return entryListCopy.searchResults;

  const filterHeading = getFilterHeading(filter);
  if (feedName === null) return filterHeading;
  if (filter === 'all') return feedName;
  return `${feedName} · ${filterHeading}`;
};
