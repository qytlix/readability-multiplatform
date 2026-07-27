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
  tagName?: string;
  searchAllFeeds?: boolean;
}

export interface EntryListHeadingPresentation {
  text: string;
  feedName: string | null;
  filterSuffix: string | null;
}

const getFilterHeading = (filter: EntryFilter): string => {
  if (filter === 'unread') return entryListCopy.unreadArticles;
  if (filter === 'starred') return entryListCopy.starredArticles;
  return entryListCopy.allArticles;
};

export const getEntryListHeadingPresentation = ({
  feedName,
  filter,
  hasActiveSearch,
  tagName,
  searchAllFeeds = false,
}: EntryListHeadingInput): EntryListHeadingPresentation => {
  if (hasActiveSearch) {
    if (feedName !== null && !searchAllFeeds) {
      return {
        text: `${feedName} · ${entryListCopy.searchResults}`,
        feedName,
        filterSuffix: entryListCopy.searchResults,
      };
    }
    if (filter !== 'all') {
      return {
        text: `${entryListCopy.searchResults} · ${getFilterHeading(filter)}`,
        feedName: null,
        filterSuffix: null,
      };
    }
    return {
      text: entryListCopy.searchResults,
      feedName: null,
      filterSuffix: null,
    };
  }

  if (tagName) {
    return {
      text: `标签：${tagName}`,
      feedName: null,
      filterSuffix: null,
    };
  }

  const filterHeading = getFilterHeading(filter);
  if (feedName === null) {
    return {
      text: filterHeading,
      feedName: null,
      filterSuffix: null,
    };
  }
  if (filter === 'all') {
    return {
      text: feedName,
      feedName,
      filterSuffix: null,
    };
  }
  return {
    text: `${feedName} · ${filterHeading}`,
    feedName,
    filterSuffix: filterHeading,
  };
};

export const getEntryListHeading = (input: EntryListHeadingInput): string =>
  getEntryListHeadingPresentation(input).text;
