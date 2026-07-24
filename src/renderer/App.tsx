import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
} from '../shared/contracts/feed.types';
import { FeedList } from './features/feeds/FeedList';
import { EntryList } from './features/feeds/EntryList';
import { EntryDetail } from './features/feeds/EntryDetail';
import { FeedAddDialog } from './features/feeds/FeedAddDialog';
import {
  getEntryAIViewState,
  updateEntryAIViewState,
  type EntryAIViewState,
  type EntryAIViewStates,
} from './features/feeds/entryAIViewState';
import {
  type EntryLoadStatus,
  type FeedLoadStatus,
} from './features/feeds/readerState';
import { AISettingsPage } from './features/settings/AISettingsPage';
import {
  loadAiPreferences,
  saveAiPreferences,
  type AiPreferences,
} from './features/settings/aiPreferences';
import {
  ForwardIcon,
  BookmarkIcon,
  FocusIcon,
  LinkIcon,
  MenuIcon,
  MoonIcon,
  MoreIcon,
  ReadIcon,
  SunIcon,
} from './features/reader/ReaderIcons';
import {
  loadReaderTheme,
  saveReaderTheme,
  type ReaderTheme,
} from './features/appearance/theme';
import {
  createHorizontalFlipKeyframes,
  type LayoutRect,
} from './features/reader/layoutTransition';
import { PaneDivider } from './features/layout/PaneDivider';
import { useReaderPaneResize } from './features/layout/useReaderPaneResize';
import {
  buildEntryQuery,
  normalizeSearchQuery,
  type EntryFilter,
} from './features/search/entrySearch';
import './features/reader/ReaderPage.css';

type AppView = 'reader' | 'settings';
type SearchStatus = 'idle' | 'searching' | 'results' | 'no-results' | 'error';

const ENTRY_PAGE_SIZE = 30;
const EMPTY_ENTRY_STATS: EntryStats = {
  all: {
    total: 0,
    unread: 0,
    readPercentage: 0,
  },
  feeds: [],
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

export const App = () => {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [entryStats, setEntryStats] = useState<EntryStats>(EMPTY_ENTRY_STATS);
  const [selectedFeedId, setSelectedFeedId] = useState<number | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [entryFilter, setEntryFilter] = useState<EntryFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearchQuery, setAppliedSearchQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState<SearchStatus>('idle');
  const [loadingFeeds, setLoadingFeeds] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [feedLoadStatus, setFeedLoadStatus] = useState<FeedLoadStatus>('loading');
  const [feedLoadError, setFeedLoadError] = useState('');
  const [entryLoadStatus, setEntryLoadStatus] = useState<EntryLoadStatus>('loading');
  const [entryLoadError, setEntryLoadError] = useState('');
  const [showAddFeedDialog, setShowAddFeedDialog] = useState(false);
  const [activeView, setActiveView] = useState<AppView>('reader');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isReadingFocus, setIsReadingFocus] = useState(false);
  const [largeType, setLargeType] = useState(false);
  const [showReaderMenu, setShowReaderMenu] = useState(false);
  const [readerFeedback, setReaderFeedback] = useState('');
  const [markingReadEntryId, setMarkingReadEntryId] = useState<number | null>(null);
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>(() =>
    loadReaderTheme(window.localStorage));
  const [articleAIToolbarTarget, setArticleAIToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [entryAIViewStates, setEntryAIViewStates] = useState<EntryAIViewStates>({});
  const [aiPreferences, setAiPreferences] = useState<AiPreferences>(() =>
    loadAiPreferences(window.localStorage));
  const [entriesCursor, setEntriesCursor] = useState<EntryQuery['cursor']>();
  const [hasMoreEntries, setHasMoreEntries] = useState(true);
  const requestSequenceRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const storyListPaneRef = useRef<HTMLElement>(null);
  const articlePaneRef = useRef<HTMLElement>(null);
  const {
    workspaceRef,
    effectiveWidth: storyListWidth,
    minimum: storyListMinimum,
    maximum: storyListMaximum,
    isDragging: isStoryListResizing,
    onPointerDown: handleStoryListResizePointerDown,
    onPointerMove: handleStoryListResizePointerMove,
    onPointerUp: handleStoryListResizePointerUp,
    onPointerCancel: handleStoryListResizePointerCancel,
    onLostPointerCapture: handleStoryListResizeLostPointerCapture,
    onKeyDown: handleStoryListResizeKeyDown,
  } = useReaderPaneResize({
    storyListRef: storyListPaneRef,
    sidebarOpen,
    readingFocus: isReadingFocus,
  });
  const layoutSnapshotRef = useRef<{
    storyList: LayoutRect | null;
    article: LayoutRect | null;
  } | null>(null);
  const layoutAnimationsRef = useRef<Animation[]>([]);

  const handleEntryAIViewStateChange = useCallback((
    entryId: number,
    change: Partial<EntryAIViewState>,
  ): void => {
    setEntryAIViewStates((current) =>
      updateEntryAIViewState(current, entryId, change));
  }, []);

  const beginReaderLayoutTransition = useCallback((updateLayout: () => void) => {
    const storyList = storyListPaneRef.current?.getBoundingClientRect() ?? null;
    const article = articlePaneRef.current?.getBoundingClientRect() ?? null;

    layoutAnimationsRef.current.forEach((animation) => animation.cancel());
    layoutAnimationsRef.current = [];
    layoutSnapshotRef.current = { storyList, article };
    updateLayout();
  }, []);

  useLayoutEffect(() => {
    const previousLayout = layoutSnapshotRef.current;
    layoutSnapshotRef.current = null;
    if (!previousLayout) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const targets = [
      {
        element: storyListPaneRef.current,
        previous: previousLayout.storyList,
      },
      {
        element: articlePaneRef.current,
        previous: previousLayout.article,
      },
    ];
    const animations: Animation[] = [];

    targets.forEach(({ element, previous }) => {
      if (!element || !previous || typeof element.animate !== 'function') return;
      const keyframes = createHorizontalFlipKeyframes(
        previous,
        element.getBoundingClientRect(),
      );
      if (!keyframes) return;

      element.style.willChange = 'transform';
      const animation = element.animate(keyframes, {
        duration: 280,
        easing: 'cubic-bezier(0.2, 0.75, 0.2, 1)',
      });
      const releaseCompositorLayer = () => {
        const hasRunningAnimation = element
          .getAnimations()
          .some((candidate) => candidate.playState === 'running');
        if (!hasRunningAnimation) element.style.removeProperty('will-change');
      };
      animation.addEventListener('finish', releaseCompositorLayer, { once: true });
      animation.addEventListener('cancel', releaseCompositorLayer, { once: true });
      animations.push(animation);
    });

    layoutAnimationsRef.current = animations;
  }, [isReadingFocus, sidebarOpen]);

  useEffect(() => () => {
    layoutAnimationsRef.current.forEach((animation) => animation.cancel());
  }, []);

  const normalizedInput = normalizeSearchQuery(searchInput);
  const searchPending = normalizedInput.length > 0
    && normalizedInput !== appliedSearchQuery;
  const effectiveSearchStatus: SearchStatus = searchPending
    ? 'searching'
    : searchStatus;

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
        setReaderFeedback(result.error.message);
        return false;
      }
      setEntryStats(result.data);
      return true;
    } catch {
      setReaderFeedback('无法读取文章统计。');
      return false;
    }
  }, []);

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
        selectedFeedId,
        filter: entryFilter,
        searchQuery: appliedSearchQuery,
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
  }, [appliedSearchQuery, entryFilter, selectedFeedId]);

  useEffect(() => {
    void loadFeeds();
    void loadEntryStats();
  }, [loadEntryStats, loadFeeds]);

  useEffect(() => {
    saveAiPreferences(window.localStorage, aiPreferences);
  }, [aiPreferences]);

  useEffect(() => {
    saveReaderTheme(window.localStorage, readerTheme);
  }, [readerTheme]);

  useEffect(() => {
    if (!normalizedInput) {
      setAppliedSearchQuery('');
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
    setShowReaderMenu(false);
    void requestEntries(undefined, false);
  }, [requestEntries]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSidebarOpen(true);
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      }

      if (event.key !== 'Escape') return;
      if (showReaderMenu) {
        setShowReaderMenu(false);
      } else if (isReadingFocus) {
        setIsReadingFocus(false);
      } else if (normalizedInput) {
        setSearchInput('');
      } else {
        setSidebarOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isReadingFocus, normalizedInput, showReaderMenu]);

  useEffect(() => {
    if (!readerFeedback) return;
    const timer = window.setTimeout(() => setReaderFeedback(''), 2200);
    return () => window.clearTimeout(timer);
  }, [readerFeedback]);

  const reloadLocalData = useCallback(async () => {
    await Promise.all([
      loadFeeds(false),
      requestEntries(undefined, false),
      loadEntryStats(),
    ]);
  }, [loadEntryStats, loadFeeds, requestEntries]);

  const handleSyncAll = useCallback(async () => {
    setLoadingFeeds(true);
    try {
      const syncResult = await window.shaleAPI.feed.sync();
      if (!syncResult.ok) {
        setReaderFeedback(syncResult.error.message);
        return false;
      }
      await Promise.all([
        loadFeeds(false),
        requestEntries(undefined, false),
        loadEntryStats(),
      ]);
      return true;
    } catch {
      setReaderFeedback('同步失败，请稍后重试。');
      return false;
    } finally {
      setLoadingFeeds(false);
    }
  }, [loadEntryStats, loadFeeds, requestEntries]);

  const handleAddFeed = useCallback(async (url: string) => {
    const result = await window.shaleAPI.feed.add(url);
    if (!result.ok) throw new Error(result.error.message);
    await Promise.all([
      loadFeeds(false),
      requestEntries(undefined, false),
      loadEntryStats(),
    ]);
  }, [loadEntryStats, loadFeeds, requestEntries]);

  const handleSelectEntry = useCallback((entryId: number) => {
    const listEntry = entries.find((entry) => entry.id === entryId);
    if (!listEntry) return;

    setActiveView('reader');
    if (selectedEntryId === entryId) {
      setSelectedEntryId(null);
      setSelectedEntry(null);
      setShowReaderMenu(false);
      setReaderFeedback('');
      return;
    }

    setSelectedEntryId(entryId);
    setSelectedEntry(toEntry(listEntry));
    setReaderFeedback('');
  }, [entries, selectedEntryId]);

  const handleReadingProgressChange = useCallback(async (
    entryId: number,
    readingProgress: number,
  ) => {
    try {
      const result = await window.shaleAPI.entry.updateReadingProgress(
        entryId,
        readingProgress,
      );
      if (!result.ok) {
        setReaderFeedback(result.error.message);
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
      setReaderFeedback('未能保存阅读进度。');
    }
  }, [loadEntryStats]);

  const handleMarkRead = useCallback(async () => {
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
      setReaderFeedback('已标记为已读。');
      await loadEntryStats();
    } catch (error) {
      setReaderFeedback(
        error instanceof Error ? error.message : '未能将文章标记为已读。',
      );
    } finally {
      setMarkingReadEntryId((current) => current === entryId ? null : current);
    }
  }, [loadEntryStats, markingReadEntryId, selectedEntry]);

  const handleToggleStarred = useCallback(async () => {
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
      setReaderFeedback(nextValue ? '已收藏到本地。' : '已取消收藏。');
      if (entryFilter === 'starred' && !nextValue && !appliedSearchQuery) {
        await requestEntries(undefined, false);
      }
    } catch (error) {
      setSelectedEntry((current) => current?.id === entryId
        ? { ...current, isStarred: !nextValue }
        : current);
      setEntries((current) => current.map((entry) =>
        entry.id === entryId ? { ...entry, isStarred: !nextValue } : entry));
      setReaderFeedback(error instanceof Error ? error.message : '未能更新收藏状态。');
    }
  }, [appliedSearchQuery, entryFilter, requestEntries, selectedEntry]);

  const handleOpenOriginal = useCallback(async () => {
    if (!selectedEntry?.url) {
      setReaderFeedback('这篇文章没有可用的原文链接。');
      return;
    }
    const result = await window.shaleAPI.external.open({ url: selectedEntry.url });
    if (!result.ok) setReaderFeedback(result.error.message);
  }, [selectedEntry?.url]);

  const handleCopyOriginal = useCallback(async () => {
    if (!selectedEntry?.url) {
      setReaderFeedback('这篇文章没有可复制的链接。');
      return;
    }
    try {
      await navigator.clipboard.writeText(selectedEntry.url);
      setReaderFeedback('原文链接已复制。');
      setShowReaderMenu(false);
    } catch {
      setReaderFeedback('无法访问剪贴板。');
    }
  }, [selectedEntry?.url]);

  const handleLoadMore = useCallback(() => {
    if (!hasMoreEntries || loadingEntries || !entriesCursor) return;
    void requestEntries(entriesCursor, true);
  }, [entriesCursor, hasMoreEntries, loadingEntries, requestEntries]);

  const handleSelectFeed = useCallback((feedId: number | null) => {
    setActiveView('reader');
    setEntryFilter('all');
    setSearchInput('');
    setAppliedSearchQuery('');
    setSearchStatus('idle');
    setSelectedFeedId(feedId);
    if (window.innerWidth < 900) setSidebarOpen(false);
  }, []);

  const handleSelectFilter = useCallback((filter: EntryFilter) => {
    setActiveView('reader');
    setSearchInput('');
    setAppliedSearchQuery('');
    setSearchStatus('idle');
    setEntryFilter(filter);
    if (filter !== 'all') setSelectedFeedId(null);
    if (window.innerWidth < 900) setSidebarOpen(false);
  }, []);

  const hasNoFeeds = feedLoadStatus === 'success' && feeds.length === 0;
  const visibleEntries = hasNoFeeds ? [] : entries;
  const listHeading = appliedSearchQuery
    ? '搜索结果'
    : entryFilter === 'unread'
      ? '未读文章'
      : entryFilter === 'starred'
        ? '收藏文章'
        : selectedFeed?.title ?? (selectedFeed ? selectedFeed.feedURL : '全部文章');
  const selectedSourceTitle = selectedEntryFeed?.title
    ?? selectedEntryFeed?.feedURL
    ?? '';

  return (
    <div
      className={[
        'reader-page',
        sidebarOpen ? 'is-sidebar-open' : 'is-sidebar-closed',
        isReadingFocus ? 'is-reading-focus' : '',
        largeType ? 'is-large-type' : '',
      ].join(' ')}
      data-theme={readerTheme}
    >
      <header className="reader-titlebar">
        <div className="reader-titlebar-leading">
          <button
            type="button"
            className="icon-button sidebar-toggle"
            aria-label={sidebarOpen ? '收起订阅源侧边栏' : '展开订阅源侧边栏'}
            aria-expanded={sidebarOpen}
            onClick={() => beginReaderLayoutTransition(() => {
              setSidebarOpen((open) => !open);
            })}
          >
            <MenuIcon />
          </button>
        </div>
        <div className="reader-window-title">Shale · Today&apos;s reading</div>
        <div className="reader-availability">
          <span className="availability-dot" />
          本地优先
        </div>
      </header>

      <button
        type="button"
        className="icon-button theme-toggle"
        aria-label={readerTheme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'}
        aria-pressed={readerTheme === 'light'}
        title={readerTheme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'}
        onClick={() => setReaderTheme((theme) =>
          theme === 'dark' ? 'light' : 'dark')}
      >
        {readerTheme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </button>

      <div
        ref={workspaceRef}
        className="reader-workspace"
      >
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="关闭订阅源侧边栏"
          tabIndex={sidebarOpen ? 0 : -1}
          onClick={() => setSidebarOpen(false)}
        />

        <aside className="reader-sidebar" aria-label="订阅源">
          <FeedList
            feeds={feeds}
            selectedFeedId={selectedFeedId}
            selectedFilter={entryFilter}
            searchInput={searchInput}
            searchStatus={effectiveSearchStatus}
            searchInputRef={searchInputRef}
            onSearchInputChange={setSearchInput}
            onSelectFilter={handleSelectFilter}
            onSelectFeed={handleSelectFeed}
            onRefresh={handleSyncAll}
            onLocalRefresh={reloadLocalData}
            onOpenAddFeed={() => setShowAddFeedDialog(true)}
            entryStats={entryStats}
            loading={loadingFeeds}
            feedLoadStatus={feedLoadStatus}
            settingsActive={activeView === 'settings'}
            onOpenSettings={() => {
              setActiveView('settings');
              setIsReadingFocus(false);
              if (window.innerWidth < 900) setSidebarOpen(false);
            }}
          />
        </aside>

        <section
          ref={storyListPaneRef}
          className="story-list-pane"
          aria-label="文章列表"
        >
          <EntryList
            entries={visibleEntries}
            selectedEntryId={selectedEntryId}
            heading={listHeading}
            loading={loadingEntries}
            loadStatus={entryLoadStatus}
            loadError={entryLoadError}
            searchQuery={normalizedInput}
            searchStatus={effectiveSearchStatus}
            filter={entryFilter}
            onFilterChange={handleSelectFilter}
            onSelectEntry={handleSelectEntry}
            onLoadMore={handleLoadMore}
            hasMore={hasNoFeeds ? false : hasMoreEntries}
          />
        </section>

        <PaneDivider
          pane="entry"
          className="reader-list-divider"
          ariaLabel="调整文章列表与阅读区宽度"
          canCollapse={false}
          effectiveWidth={storyListWidth}
          minimum={storyListMinimum}
          maximum={storyListMaximum}
          isDragging={isStoryListResizing}
          isCollapseArmed={false}
          onPointerDown={(_pane, event) => handleStoryListResizePointerDown(event)}
          onPointerMove={(_pane, event) => handleStoryListResizePointerMove(event)}
          onPointerUp={(_pane, event) => handleStoryListResizePointerUp(event)}
          onPointerCancel={(_pane, event) => handleStoryListResizePointerCancel(event)}
          onLostPointerCapture={(_pane, event) =>
            handleStoryListResizeLostPointerCapture(event)}
          onKeyDown={(_pane, event) => handleStoryListResizeKeyDown(event)}
        />

        <main ref={articlePaneRef} className="article-pane">
          <div className="article-toolbar">
            <div className="article-toolbar-source">
              <button
                type="button"
                className="icon-button reader-focus-toggle"
                aria-label={isReadingFocus ? '退出专注阅读' : '进入专注阅读'}
                aria-pressed={isReadingFocus}
                onClick={() => beginReaderLayoutTransition(() => {
                  setIsReadingFocus((focused) => !focused);
                })}
              >
                {isReadingFocus ? <ForwardIcon /> : <FocusIcon />}
              </button>
              {!isReadingFocus && (
                <span>{activeView === 'settings' ? '设置' : selectedSourceTitle}</span>
              )}
            </div>

            {activeView === 'reader' && (
              <div className="article-actions">
                <div
                  ref={setArticleAIToolbarTarget}
                  className="article-ai-actions-slot"
                />
                <span
                  className="article-action-tooltip"
                  data-tooltip={
                    markingReadEntryId === selectedEntry?.id
                      ? '正在标记为已读'
                      : selectedEntry?.isRead
                        ? '已标记为已读'
                        : '标记为已读'
                  }
                >
                  <button
                    type="button"
                    className={`icon-button article-read-button${
                      selectedEntry?.isRead ? ' is-active' : ''
                    }`}
                    aria-label={
                      selectedEntry?.isRead ? '已标记为已读' : '标记为已读'
                    }
                    aria-pressed={selectedEntry?.isRead ?? false}
                    aria-busy={markingReadEntryId === selectedEntry?.id}
                    disabled={
                      !selectedEntry
                      || selectedEntry.isRead
                      || markingReadEntryId === selectedEntry.id
                    }
                    onClick={() => void handleMarkRead()}
                  >
                    <ReadIcon />
                  </button>
                </span>
                <span
                  className="article-action-tooltip"
                  data-tooltip={selectedEntry?.isStarred ? '取消收藏' : '收藏文章'}
                >
                  <button
                    type="button"
                    className={`icon-button${selectedEntry?.isStarred ? ' is-active' : ''}`}
                    aria-label={selectedEntry?.isStarred ? '取消收藏' : '收藏文章'}
                    aria-pressed={selectedEntry?.isStarred ?? false}
                    disabled={!selectedEntry}
                    onClick={() => void handleToggleStarred()}
                  >
                    <BookmarkIcon filled={selectedEntry?.isStarred ?? false} />
                  </button>
                </span>
                <span
                  className="article-action-tooltip"
                  data-tooltip="在浏览器中打开原文"
                >
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="在浏览器中打开原文"
                    disabled={!selectedEntry?.url}
                    onClick={() => void handleOpenOriginal()}
                  >
                    <LinkIcon />
                  </button>
                </span>
                <span
                  className="article-action-tooltip"
                  data-tooltip={largeType ? '恢复默认字号' : '放大正文字号'}
                >
                  <button
                    type="button"
                    className={`type-button${largeType ? ' is-active' : ''}`}
                    aria-label="切换字号"
                    aria-pressed={largeType}
                    onClick={() => setLargeType((value) => !value)}
                  >
                    Aa
                  </button>
                </span>
                <div className="article-more">
                  <button
                    type="button"
                    className={`icon-button${showReaderMenu ? ' is-active' : ''}`}
                    aria-label="更多文章操作"
                    aria-expanded={showReaderMenu}
                    onClick={() => setShowReaderMenu((visible) => !visible)}
                  >
                    <MoreIcon />
                  </button>
                  {showReaderMenu && (
                    <div className="article-more-menu">
                      <button type="button" onClick={() => void handleCopyOriginal()}>
                        复制原文链接
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveView('settings');
                          setShowReaderMenu(false);
                        }}
                      >
                        AI 阅读设置
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="article-stage">
            {activeView === 'settings' ? (
              <AISettingsPage
                preferences={aiPreferences}
                onPreferencesChange={setAiPreferences}
              />
            ) : (
              <EntryDetail
                entry={selectedEntry}
                aiViewState={getEntryAIViewState(
                  entryAIViewStates,
                  selectedEntry?.id ?? null,
                )}
                feedLoadStatus={feedLoadStatus}
                feedLoadError={feedLoadError}
                feedCount={feeds.length}
                entryLoadStatus={entryLoadStatus}
                entryLoadError={entryLoadError}
                entryCount={visibleEntries.length}
                onAddFeed={() => setShowAddFeedDialog(true)}
                onRetryFeeds={() => {
                  void loadFeeds();
                }}
                onRetryEntries={() => {
                  void requestEntries(undefined, false);
                }}
                aiPreferences={aiPreferences}
                aiToolbarTarget={articleAIToolbarTarget}
                onAIViewStateChange={handleEntryAIViewStateChange}
                onReadingProgressChange={handleReadingProgressChange}
              />
            )}
          </div>
        </main>
      </div>

      <div className="annotation-overlay-root" />

      {readerFeedback && (
        <div className="reader-toast" role="status">{readerFeedback}</div>
      )}

      {showAddFeedDialog && (
        <FeedAddDialog
          onAdd={handleAddFeed}
          onClose={() => setShowAddFeedDialog(false)}
        />
      )}
    </div>
  );
};
