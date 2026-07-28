import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  Entry,
  EntryListItem,
  EntryQuery,
  EntryStats,
  Feed,
} from '../../../shared/contracts/feed.types';
import {
  buildEntryQuery,
  normalizeSearchQuery,
  type EntryFilter,
  type TagFilterState,
} from '../search/entrySearch';
import type {
  EntryLoadStatus,
  FeedLoadStatus,
} from '../feeds/readerState';

export type ReaderSearchStatus =
  | 'idle'
  | 'searching'
  | 'results'
  | 'no-results'
  | 'error';

export interface ReaderWorkspaceState {
  feeds: Feed[];
  entries: EntryListItem[];
  visibleEntries: EntryListItem[];
  entryStats: EntryStats;
  selectedFeedId: number | null;
  selectedFeed: Feed | null;
  selectedEntryId: number | null;
  selectedEntry: Entry | null;
  selectedEntryFeed: Feed | null;
  entryFilter: EntryFilter;
  tagFilter: TagFilterState | null;
  searchInput: string;
  normalizedSearchInput: string;
  appliedSearchQuery: string;
  searchAllFeeds: boolean;
  searchStatus: ReaderSearchStatus;
  effectiveSearchStatus: ReaderSearchStatus;
  searchPending: boolean;
  hasSearchInput: boolean;
  loadingFeeds: boolean;
  loadingEntries: boolean;
  feedLoadStatus: FeedLoadStatus;
  feedLoadError: string;
  entryLoadStatus: EntryLoadStatus;
  entryLoadError: string;
  hasMoreEntries: boolean;
  hasNoFeeds: boolean;
  markingReadEntryId: number | null;
  selectionMode: boolean;
  selectedIds: Set<number>;
}

export interface ReaderWorkspaceActions {
  setSearchInput: (value: string) => void;
  setSearchAllFeeds: (enabled: boolean) => void;
  setSelectionMode: (enabled: boolean) => void;
  toggleSelectedId: (entryId: number) => void;
  selectEntry: (entryId: number) => void;
  selectTag: (tagName: string) => void;
  openTags: () => void;
  selectFeed: (feedId: number | null) => void;
  selectSidebarFilter: (filter: EntryFilter) => void;
  selectEntryListFilter: (filter: EntryFilter) => void;
  loadMore: () => void;
  retryFeeds: () => Promise<boolean>;
  retryEntries: () => Promise<boolean>;
  refreshAfterTagsChanged: () => Promise<void>;
  reloadLocalData: () => Promise<void>;
  syncAll: () => Promise<boolean>;
  addFeed: (url: string) => Promise<void>;
  updateReadingProgress: (
    entryId: number,
    readingProgress: number,
  ) => Promise<void>;
  markRead: () => Promise<void>;
  toggleStarred: () => Promise<void>;
}

export interface ReaderWorkspace {
  state: ReaderWorkspaceState;
  actions: ReaderWorkspaceActions;
}

interface UseReaderWorkspaceOptions {
  onFeedback: (message: string) => void;
}

const ENTRY_PAGE_SIZE = 30;

const EMPTY_ENTRY_STATS: EntryStats = {
  all: { total: 0, unread: 0, readPercentage: 0 },
  feeds: [],
  tagCount: 0,
};

const toEntry = (entry: EntryListItem): Entry => ({
  id: entry.id,
  feedId: entry.feedId,
  url: entry.url,
  title: entry.title,
  author: entry.author,
  publishedAt: entry.publishedAt,
  createdAt: entry.createdAt,
  isRead: entry.isRead,
  readingProgress: entry.readingProgress,
  isStarred: entry.isStarred,
  isDeleted: false,
  updatedAt: entry.createdAt,
  summary: entry.summary,
});

/** 集中维护 Reader 工作区的加载、查询、分页和选择不变量。 */
export const useReaderWorkspace = ({
  onFeedback,
}: UseReaderWorkspaceOptions): ReaderWorkspace => {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [entryStats, setEntryStats] = useState<EntryStats>(EMPTY_ENTRY_STATS);
  const [selectedFeedId, setSelectedFeedId] = useState<number | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [entryFilter, setEntryFilter] = useState<EntryFilter>('all');
  const [tagFilter, setTagFilter] = useState<TagFilterState | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearchQuery, setAppliedSearchQuery] = useState('');
  const [searchAllFeeds, setSearchAllFeeds] = useState(false);
  const [searchStatus, setSearchStatus] = useState<ReaderSearchStatus>('idle');
  const [loadingFeeds, setLoadingFeeds] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [feedLoadStatus, setFeedLoadStatus] =
    useState<FeedLoadStatus>('loading');
  const [feedLoadError, setFeedLoadError] = useState('');
  const [entryLoadStatus, setEntryLoadStatus] =
    useState<EntryLoadStatus>('loading');
  const [entryLoadError, setEntryLoadError] = useState('');
  const [entriesCursor, setEntriesCursor] = useState<EntryQuery['cursor']>();
  const [hasMoreEntries, setHasMoreEntries] = useState(true);
  const [markingReadEntryId, setMarkingReadEntryId] =
    useState<number | null>(null);
  const [selectionMode, setSelectionModeState] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const requestSequenceRef = useRef(0);
  const onFeedbackRef = useRef(onFeedback);
  onFeedbackRef.current = onFeedback;

  const reportFeedback = useCallback((message: string): void => {
    onFeedbackRef.current(message);
  }, []);

  const normalizedInput = normalizeSearchQuery(searchInput);
  const searchPending = normalizedInput.length > 0
    && normalizedInput !== appliedSearchQuery;
  const effectiveSearchStatus: ReaderSearchStatus = searchPending
    ? 'searching'
    : searchStatus;
  const searchFeedId = appliedSearchQuery && searchAllFeeds
    ? null
    : selectedFeedId;

  const selectedFeed = useMemo(
    () => feeds.find((feed) => feed.id === selectedFeedId) ?? null,
    [feeds, selectedFeedId],
  );
  const selectedEntryFeed = useMemo(
    () => feeds.find((feed) => feed.id === selectedEntry?.feedId) ?? null,
    [feeds, selectedEntry?.feedId],
  );

  const loadFeeds = useCallback(async (showLoadingState = true) => {
    setLoadingFeeds(true);
    if (showLoadingState) {
      setFeedLoadStatus('loading');
      setFeedLoadError('');
    }
    try {
      const result = await window.shaleAPI.feed.list();
      if (!result.ok) {
        setFeedLoadStatus('error');
        setFeedLoadError(result.error.message);
        return false;
      }
      setFeeds(result.data);
      setFeedLoadStatus('success');
      return true;
    } catch {
      setFeedLoadStatus('error');
      setFeedLoadError('无法读取本地订阅源。');
      return false;
    } finally {
      setLoadingFeeds(false);
    }
  }, []);

  const loadEntryStats = useCallback(async () => {
    try {
      const result = await window.shaleAPI.entry.stats();
      if (!result.ok) {
        reportFeedback(result.error.message);
        return false;
      }
      setEntryStats(result.data);
      return true;
    } catch {
      reportFeedback('无法读取文章统计。');
      return false;
    }
  }, [reportFeedback]);

  const requestEntries = useCallback(async (
    cursor: EntryQuery['cursor'],
    append: boolean,
  ) => {
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    setLoadingEntries(true);
    if (!append) {
      setEntryLoadStatus('loading');
      setEntryLoadError('');
      if (appliedSearchQuery) setSearchStatus('searching');
    }

    try {
      const params = buildEntryQuery({
        selectedFeedId: searchFeedId,
        filter: entryFilter,
        searchQuery: appliedSearchQuery,
        tagFilter,
        limit: ENTRY_PAGE_SIZE,
        cursor,
      });
      const result = await window.shaleAPI.entry.list(params);
      if (requestSequenceRef.current !== requestSequence) return false;
      if (!result.ok) {
        if (!append) {
          setEntryLoadStatus('error');
          setEntryLoadError(result.error.message);
          setHasMoreEntries(false);
          if (appliedSearchQuery) setSearchStatus('error');
        }
        return false;
      }

      setEntries((current) => append
        ? [...current, ...result.data.entries]
        : result.data.entries);
      setEntriesCursor(result.data.nextCursor);
      setHasMoreEntries(Boolean(result.data.nextCursor));
      setEntryLoadStatus('success');
      setSearchStatus(appliedSearchQuery
        ? result.data.entries.length > 0 || append ? 'results' : 'no-results'
        : 'idle');
      return true;
    } catch {
      if (requestSequenceRef.current !== requestSequence) return false;
      if (!append) {
        setEntryLoadStatus('error');
        setEntryLoadError('无法读取本地文章。');
        setHasMoreEntries(false);
        if (appliedSearchQuery) setSearchStatus('error');
      }
      return false;
    } finally {
      if (requestSequenceRef.current === requestSequence) {
        setLoadingEntries(false);
      }
    }
  }, [appliedSearchQuery, entryFilter, searchFeedId, tagFilter]);

  useEffect(() => {
    void loadFeeds();
    void loadEntryStats();
  }, [loadEntryStats, loadFeeds]);

  useEffect(() => {
    if (!normalizedInput) {
      setAppliedSearchQuery('');
      setSearchAllFeeds(false);
      setSearchStatus('idle');
      return;
    }

    if (normalizedInput === appliedSearchQuery) return;
    const timer = window.setTimeout(() => {
      setAppliedSearchQuery(normalizedInput);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [appliedSearchQuery, normalizedInput]);

  useEffect(() => {
    setEntries([]);
    setEntriesCursor(undefined);
    setHasMoreEntries(true);
    setSelectedEntryId(null);
    setSelectedEntry(null);
    void requestEntries(undefined, false);
  }, [requestEntries]);

  const reloadLocalData = useCallback(async () => {
    await Promise.all([
      loadFeeds(false),
      requestEntries(undefined, false),
      loadEntryStats(),
    ]);
  }, [loadEntryStats, loadFeeds, requestEntries]);

  const retryFeeds = useCallback(
    () => loadFeeds(),
    [loadFeeds],
  );

  const retryEntries = useCallback(
    () => requestEntries(undefined, false),
    [requestEntries],
  );

  const refreshAfterTagsChanged = useCallback(async () => {
    await Promise.all([
      requestEntries(undefined, false),
      loadEntryStats(),
    ]);
  }, [loadEntryStats, requestEntries]);

  const syncAll = useCallback(async () => {
    setLoadingFeeds(true);
    try {
      const syncResult = await window.shaleAPI.feed.sync();
      if (!syncResult.ok) {
        reportFeedback(syncResult.error.message);
        return false;
      }
      await Promise.all([
        loadFeeds(false),
        requestEntries(undefined, false),
        loadEntryStats(),
      ]);
      return true;
    } catch {
      reportFeedback('同步失败，请稍后重试。');
      return false;
    } finally {
      setLoadingFeeds(false);
    }
  }, [loadEntryStats, loadFeeds, reportFeedback, requestEntries]);

  const addFeed = useCallback(async (url: string) => {
    const result = await window.shaleAPI.feed.add(url);
    if (!result.ok) throw new Error(result.error.message);
    await Promise.all([
      loadFeeds(false),
      requestEntries(undefined, false),
      loadEntryStats(),
    ]);
  }, [loadEntryStats, loadFeeds, requestEntries]);

  const selectEntry = useCallback((entryId: number) => {
    const listEntry = entries.find((entry) => entry.id === entryId);
    if (!listEntry) return;

    if (selectedEntryId === entryId) {
      setSelectedEntryId(null);
      setSelectedEntry(null);
      return;
    }

    setSelectedEntryId(entryId);
    setSelectedEntry(toEntry(listEntry));
  }, [entries, selectedEntryId]);

  const updateReadingProgress = useCallback(async (
    entryId: number,
    readingProgress: number,
  ) => {
    try {
      const result = await window.shaleAPI.entry.updateReadingProgress(
        entryId,
        readingProgress,
      );
      if (!result.ok) {
        reportFeedback(result.error.message);
        return;
      }

      const updated = result.data;
      setEntries((current) => current.map((item) =>
        item.id === entryId
          ? {
              ...item,
              readingProgress: updated.readingProgress,
              isRead: updated.isRead,
            }
          : item));
      setSelectedEntry((current) => current?.id === entryId
        ? {
            ...current,
            readingProgress: updated.readingProgress,
            isRead: updated.isRead,
          }
        : current);

      if (updated.becameRead) {
        await loadEntryStats();
      }
    } catch {
      reportFeedback('未能保存阅读进度。');
    }
  }, [loadEntryStats, reportFeedback]);

  const markRead = useCallback(async () => {
    if (
      !selectedEntry
      || selectedEntry.isRead
      || markingReadEntryId === selectedEntry.id
    ) {
      return;
    }

    const entryId = selectedEntry.id;
    setMarkingReadEntryId(entryId);
    try {
      const result = await window.shaleAPI.entry.markRead([entryId], true);
      if (!result.ok) throw new Error(result.error.message);

      setEntries((current) => current.map((entry) =>
        entry.id === entryId
          ? { ...entry, isRead: true, readingProgress: 1 }
          : entry));
      setSelectedEntry((current) => current?.id === entryId
        ? { ...current, isRead: true, readingProgress: 1 }
        : current);
      reportFeedback('已标记为已读。');
      await loadEntryStats();
    } catch (error) {
      reportFeedback(
        error instanceof Error ? error.message : '未能将文章标记为已读。',
      );
    } finally {
      setMarkingReadEntryId((current) => current === entryId ? null : current);
    }
  }, [
    loadEntryStats,
    markingReadEntryId,
    reportFeedback,
    selectedEntry,
  ]);

  const toggleStarred = useCallback(async () => {
    if (!selectedEntry) return;
    const nextValue = !selectedEntry.isStarred;
    const entryId = selectedEntry.id;
    setSelectedEntry((current) => current?.id === entryId
      ? { ...current, isStarred: nextValue }
      : current);
    setEntries((current) => current.map((entry) =>
      entry.id === entryId ? { ...entry, isStarred: nextValue } : entry));

    try {
      const result = await window.shaleAPI.entry.markStarred(entryId, nextValue);
      if (!result.ok) throw new Error(result.error.message);
      reportFeedback(nextValue ? '已收藏到本地。' : '已取消收藏。');
      if (entryFilter === 'starred' && !nextValue && !appliedSearchQuery) {
        await requestEntries(undefined, false);
      }
    } catch (error) {
      setSelectedEntry((current) => current?.id === entryId
        ? { ...current, isStarred: !nextValue }
        : current);
      setEntries((current) => current.map((entry) =>
        entry.id === entryId ? { ...entry, isStarred: !nextValue } : entry));
      reportFeedback(
        error instanceof Error ? error.message : '未能更新收藏状态。',
      );
    }
  }, [
    appliedSearchQuery,
    entryFilter,
    reportFeedback,
    requestEntries,
    selectedEntry,
  ]);

  const loadMore = useCallback(() => {
    if (!hasMoreEntries || loadingEntries || !entriesCursor) return;
    void requestEntries(entriesCursor, true);
  }, [entriesCursor, hasMoreEntries, loadingEntries, requestEntries]);

  const clearMultiSelection = useCallback((): void => {
    setSelectionModeState(false);
    setSelectedIds(new Set());
  }, []);

  const resetSearch = useCallback((): void => {
    setSearchInput('');
    setAppliedSearchQuery('');
    setSearchAllFeeds(false);
    setSearchStatus('idle');
  }, []);

  const selectTag = useCallback((tagName: string) => {
    setTagFilter({ tagNames: [tagName], matchAll: true });
    setSelectedFeedId(null);
    setEntryFilter('all');
    resetSearch();
    clearMultiSelection();
  }, [clearMultiSelection, resetSearch]);

  const openTags = useCallback(() => {
    setTagFilter(null);
    setSelectedFeedId(null);
    setEntryFilter('all');
    resetSearch();
  }, [resetSearch]);

  const selectFeed = useCallback((feedId: number | null) => {
    setTagFilter(null);
    setEntryFilter('all');
    resetSearch();
    setSelectedFeedId(feedId);
    clearMultiSelection();
  }, [clearMultiSelection, resetSearch]);

  const selectSidebarFilter = useCallback((filter: EntryFilter) => {
    setTagFilter(null);
    resetSearch();
    setEntryFilter(filter);
    clearMultiSelection();
    if (filter !== 'all') setSelectedFeedId(null);
  }, [clearMultiSelection, resetSearch]);

  const selectEntryListFilter = useCallback((filter: EntryFilter) => {
    setTagFilter(null);
    resetSearch();
    setEntryFilter(filter);
    clearMultiSelection();
  }, [clearMultiSelection, resetSearch]);

  const setSelectionMode = useCallback((enabled: boolean): void => {
    setSelectionModeState(enabled);
    if (!enabled) setSelectedIds(new Set());
  }, []);

  const toggleSelectedId = useCallback((entryId: number): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }, []);

  const hasNoFeeds = feedLoadStatus === 'success' && feeds.length === 0;

  return {
    state: {
      feeds,
      entries,
      visibleEntries: hasNoFeeds ? [] : entries,
      entryStats,
      selectedFeedId,
      selectedFeed,
      selectedEntryId,
      selectedEntry,
      selectedEntryFeed,
      entryFilter,
      tagFilter,
      searchInput,
      normalizedSearchInput: normalizedInput,
      appliedSearchQuery,
      searchAllFeeds,
      searchStatus,
      effectiveSearchStatus,
      searchPending,
      hasSearchInput: normalizedInput.length > 0,
      loadingFeeds,
      loadingEntries,
      feedLoadStatus,
      feedLoadError,
      entryLoadStatus,
      entryLoadError,
      hasMoreEntries,
      hasNoFeeds,
      markingReadEntryId,
      selectionMode,
      selectedIds,
    },
    actions: {
      setSearchInput,
      setSearchAllFeeds,
      setSelectionMode,
      toggleSelectedId,
      selectEntry,
      selectTag,
      openTags,
      selectFeed,
      selectSidebarFilter,
      selectEntryListFilter,
      loadMore,
      retryFeeds,
      retryEntries,
      refreshAfterTagsChanged,
      reloadLocalData,
      syncAll,
      addFeed,
      updateReadingProgress,
      markRead,
      toggleStarred,
    },
  };
};
