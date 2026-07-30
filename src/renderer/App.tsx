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
import { getEntryListHeadingPresentation } from './features/feeds/entryListPresentation';
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
  checkAvailability,
  exportMultipleEntries,
} from './features/feeds/entryExport';
import { ExportOptionsDialog } from './features/feeds/ExportOptionsDialog';
import type { TagFilterState } from './features/search/entrySearch';
import { TagListPage } from './features/tags/TagListPage';
import { SearchOverlay } from './features/search/SearchOverlay';
import { ArticleChatPanel } from './features/chat/ArticleChatPanel';
import {
  createArticleChatLayoutSnapshot,
  restoreReaderColumnState,
  type ArticleChatLayoutSnapshot,
} from './features/chat/articleChatLayout';
import type {
  ArticleChatSelectionRequest,
} from './features/chat/articleChatSelection';
import type { ChatSelectionContext } from '../shared/contracts/chat.types';
import './features/tags/TagListPage.css';
import type { ArticleAvailability } from '../shared/contracts/export.types';
import {
  ForwardIcon,
  BookmarkIcon,
  CheckIcon,
  CopyIcon,
  ExportIcon,
  FocusIcon,
  LinkIcon,
  MenuIcon,
  MoonIcon,
  ReadIcon,
  SunIcon,
} from './features/reader/ReaderIcons';
import { ArticleSyncMenu } from './features/reader/ArticleSyncMenu';
import { TranslationSetupNoticeDialog } from './features/translation/TranslationSetupNoticeDialog';
import { TranslationNoticeDialog } from './features/translation/TranslationNoticeDialog';
import {
  loadReaderTheme,
  saveReaderTheme,
  type ReaderTheme,
} from './features/appearance/theme';
import {
  loadReaderPreferences,
  saveReaderPreferences,
  type ReaderPreferences,
} from './features/settings/readerPreferences';
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

type AppView = 'reader' | 'settings' | 'tags';
type SearchStatus = 'idle' | 'searching' | 'results' | 'no-results' | 'error';

const ENTRY_PAGE_SIZE = 30;
const EMPTY_ENTRY_STATS: EntryStats = {
  all: {
    total: 0,
    unread: 0,
    readPercentage: 0,
  },
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

export const App = () => {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [entryStats, setEntryStats] = useState<EntryStats>(EMPTY_ENTRY_STATS);
  const [tagCount, setTagCount] = useState(0);
  const [selectedFeedId, setSelectedFeedId] = useState<number | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [entryFilter, setEntryFilter] = useState<EntryFilter>('all');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearchQuery, setAppliedSearchQuery] = useState('');
  const [searchAllFeeds, setSearchAllFeeds] = useState(false);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>('idle');
  const [loadingFeeds, setLoadingFeeds] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [feedLoadStatus, setFeedLoadStatus] = useState<FeedLoadStatus>('loading');
  const [feedLoadError, setFeedLoadError] = useState('');
  const [entryLoadStatus, setEntryLoadStatus] = useState<EntryLoadStatus>('loading');
  const [entryLoadError, setEntryLoadError] = useState('');
  const [showAddFeedDialog, setShowAddFeedDialog] = useState(false);
  const [activeView, setActiveView] = useState<AppView>('reader');
  const [tagFilter, setTagFilter] = useState<TagFilterState | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isReadingFocus, setIsReadingFocus] = useState(false);
  const [largeType, setLargeType] = useState(false);
  const [copiedOriginalEntryId, setCopiedOriginalEntryId] =
    useState<number | null>(null);
  const [readerFeedback, setReaderFeedback] = useState('');
  const [contentRefreshVersions, setContentRefreshVersions] =
    useState<Record<number, number>>({});
  const [refreshingContentEntryId, setRefreshingContentEntryId] =
    useState<number | null>(null);
  const [retranslationRequest, setRetranslationRequest] = useState<{
    entryId: number;
    version: number;
  } | null>(null);
  const [showTranslationSetupNotice, setShowTranslationSetupNotice] = useState(false);
  const [retranslationNotice, setRetranslationNotice] = useState<string | null>(null);
  const [markingReadEntryId, setMarkingReadEntryId] = useState<number | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportArticles, setExportArticles] = useState<ArticleAvailability[]>([]);
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>(() =>
    loadReaderTheme(window.localStorage));
  const [readerPreferences, setReaderPreferences] = useState<ReaderPreferences>(() =>
    loadReaderPreferences(window.localStorage));
  const [articleAIToolbarTarget, setArticleAIToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [articleExportToolbarTarget, setArticleExportToolbarTarget] =
    useState<HTMLDivElement | null>(null);
  const [entryAIViewStates, setEntryAIViewStates] = useState<EntryAIViewStates>({});
  const [aiPreferences, setAiPreferences] = useState<AiPreferences>(() =>
    loadAiPreferences(window.localStorage));
  const [entriesCursor, setEntriesCursor] = useState<EntryQuery['cursor']>();
  const [hasMoreEntries, setHasMoreEntries] = useState(true);
  const [articleChatOpen, setArticleChatOpen] = useState(false);
  const [articleChatSelectionRequest, setArticleChatSelectionRequest] =
    useState<ArticleChatSelectionRequest | undefined>();
  const [activeArticleChatRun, setActiveArticleChatRun] = useState<{
    entryId: number;
    runId: number;
  } | null>(null);
  const requestSequenceRef = useRef(0);
  const translationSetupNoticeResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const storyListPaneRef = useRef<HTMLElement>(null);
  const articlePaneRef = useRef<HTMLElement>(null);
  const articleChatLayoutSnapshotRef =
    useRef<ArticleChatLayoutSnapshot | null>(null);
  const articleChatSelectionSequenceRef = useRef(0);
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

  const openArticleChat = useCallback(() => {
    if (!selectedEntry) return;
    articleChatLayoutSnapshotRef.current = createArticleChatLayoutSnapshot({
      sidebarOpen,
      readingFocus: isReadingFocus,
      storyListWidth,
    });
    setSearchFocused(false);
    setArticleChatOpen(true);
  }, [isReadingFocus, selectedEntry, sidebarOpen, storyListWidth]);

  const closeArticleChat = useCallback(() => {
    const snapshot = articleChatLayoutSnapshotRef.current;
    articleChatLayoutSnapshotRef.current = null;
    setArticleChatOpen(false);
    if (!snapshot) return;
    const restored = restoreReaderColumnState(snapshot);
    setSidebarOpen(restored.sidebarOpen);
    setIsReadingFocus(restored.readingFocus);
  }, []);

  const openArticleChatForSelection = useCallback((
    selection: ChatSelectionContext,
  ): void => {
    if (!selectedEntry || selection.entryId !== selectedEntry.id) return;
    articleChatSelectionSequenceRef.current += 1;
    setArticleChatSelectionRequest({
      requestId: articleChatSelectionSequenceRef.current,
      selection,
    });
    if (!articleChatOpen) openArticleChat();
  }, [articleChatOpen, openArticleChat, selectedEntry]);

  const consumeArticleChatSelection = useCallback((requestId: number): void => {
    setArticleChatSelectionRequest((current) => (
      current?.requestId === requestId ? undefined : current
    ));
  }, []);

  useEffect(() => {
    setArticleChatSelectionRequest(undefined);
  }, [selectedEntryId]);

  useEffect(() => {
    if (
      !activeArticleChatRun
      || activeArticleChatRun.entryId === selectedEntryId
    ) {
      return;
    }

    const runId = activeArticleChatRun.runId;
    setActiveArticleChatRun(null);
    void window.shaleAPI.chat.cancel({ runId });
  }, [activeArticleChatRun, selectedEntryId]);

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

  const loadTagCount = useCallback(async () => {
    try {
      const result = await window.shaleAPI.tag.listAllWithCount();
      if (result.ok) setTagCount(result.data.length);
      return true;
    } catch {
      setReaderFeedback('无法读取标签数量。');
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
    void loadTagCount();
  }, [loadEntryStats, loadFeeds, loadTagCount]);

  useEffect(() => {
    saveAiPreferences(window.localStorage, aiPreferences);
  }, [aiPreferences]);

  useEffect(() => {
    saveReaderTheme(window.localStorage, readerTheme);
  }, [readerTheme]);

  useEffect(() => {
    saveReaderPreferences(window.localStorage, readerPreferences);
  }, [readerPreferences]);

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
    setCopiedOriginalEntryId(null);
    void requestEntries(undefined, false);
  }, [requestEntries]);

useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (isReadingFocus) return;
        setSidebarOpen(true);
        setSearchFocused(true);
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      }

      if (event.key !== 'Escape') return;
      if (articleChatOpen) {
        closeArticleChat();
        return;
      }
      if (searchFocused) {
        if (normalizedInput) {
          setSearchInput('');
        } else {
          setSearchFocused(false);
        }
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
  }, [
    articleChatOpen,
    closeArticleChat,
    isReadingFocus,
    normalizedInput,
    searchFocused,
  ]);

  useEffect(() => {
    if (!readerFeedback) return;
    const timer = window.setTimeout(() => setReaderFeedback(''), 2200);
    return () => window.clearTimeout(timer);
  }, [readerFeedback]);

  useEffect(() => {
    if (copiedOriginalEntryId === null) return;
    const timer = window.setTimeout(() => setCopiedOriginalEntryId(null), 2800);
    return () => window.clearTimeout(timer);
  }, [copiedOriginalEntryId]);

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
      setCopiedOriginalEntryId(null);
      setReaderFeedback('');
      return;
    }

    setSelectedEntryId(entryId);
    setSelectedEntry(toEntry(listEntry));
    setCopiedOriginalEntryId(null);
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
    const entryId = selectedEntry.id;
    try {
      await navigator.clipboard.writeText(selectedEntry.url);
      setReaderFeedback('原文链接已复制。');
      setCopiedOriginalEntryId(entryId);
    } catch {
      setReaderFeedback('无法访问剪贴板。');
    }
  }, [selectedEntry]);

  const handleRefreshContent = useCallback(() => {
    if (!selectedEntry?.url) {
      setReaderFeedback('这篇文章没有可重新获取的原文链接。');
      return;
    }

    const entryId = selectedEntry.id;
    setContentRefreshVersions((current) => ({
      ...current,
      [entryId]: (current[entryId] ?? 0) + 1,
    }));
    setRefreshingContentEntryId(entryId);
    setReaderFeedback('正在重新获取并提取正文…');
  }, [selectedEntry]);

  const handleContentRefreshComplete = useCallback((
    entryId: number,
    result: { ok: true } | { ok: false; message: string },
  ): void => {
    setRefreshingContentEntryId((current) =>
      current === entryId ? null : current);
    setReaderFeedback(
      result.ok ? '正文已更新。' : `正文更新失败：${result.message}`,
    );
  }, []);

  const requestTranslationSetupNotice = useCallback((): Promise<boolean> | boolean => {
    if (aiPreferences.translationSetupNoticeAcknowledged) return true;
    return new Promise((resolve) => {
      translationSetupNoticeResolverRef.current = resolve;
      setShowTranslationSetupNotice(true);
    });
  }, [aiPreferences.translationSetupNoticeAcknowledged]);

  const handleTranslationSetupNoticeConfirm = useCallback(() => {
    setAiPreferences((current) => ({
      ...current,
      translationSetupNoticeAcknowledged: true,
    }));
    setShowTranslationSetupNotice(false);
    const resolve = translationSetupNoticeResolverRef.current;
    translationSetupNoticeResolverRef.current = null;
    resolve?.(true);
  }, []);

  const handleRetranslateArticle = useCallback(() => {
    if (!selectedEntry) {
      setReaderFeedback('当前文章尚未拉取成功');
      return;
    }
    setRetranslationRequest((current) => ({
      entryId: selectedEntry.id,
      version: (current?.version ?? 0) + 1,
    }));
  }, [selectedEntry]);

  const handleRetranslationRequestComplete = useCallback((
    entryId: number,
    result: 'started' | 'content-unavailable' | 'no-translation' | 'active' | 'failed',
  ): void => {
    if (selectedEntry?.id !== entryId) return;
    if (result === 'content-unavailable') {
      setRetranslationNotice('当前文章尚未拉取成功');
    } else if (result === 'no-translation') {
      setRetranslationNotice('当前文章还没有翻译');
    } else if (result === 'active') {
      setRetranslationNotice('当前文章的翻译任务正在进行，请使用主翻译按钮暂停或继续。');
    }
  }, [selectedEntry?.id]);

  const handleLoadMore = useCallback(() => {
    if (!hasMoreEntries || loadingEntries || !entriesCursor) return;
    void requestEntries(entriesCursor, true);
  }, [entriesCursor, hasMoreEntries, loadingEntries, requestEntries]);

  const handleSelectTag = useCallback((tagName: string) => {
    setActiveView('reader');
    setTagFilter({ tagNames: [tagName], matchAll: true });
    setSelectedFeedId(null);
    setEntryFilter('all');
    setSearchInput('');
    setAppliedSearchQuery('');
    setSearchStatus('idle');
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleOpenTags = useCallback(() => {
    setActiveView('tags');
    setTagFilter(null);
    setSelectedFeedId(null);
    setEntryFilter('all');
    setSearchInput('');
    setAppliedSearchQuery('');
    setSearchStatus('idle');
    if (window.innerWidth < 900) setSidebarOpen(false);
  }, []);

  const handleSelectFeed = useCallback((feedId: number | null) => {
    setActiveView('reader');
    setTagFilter(null);
    setEntryFilter('all');
    setSearchInput('');
    setAppliedSearchQuery('');
    setSearchAllFeeds(false);
    setSearchStatus('idle');
    setSelectedFeedId(feedId);
    setSelectionMode(false);
    setSelectedIds(new Set());
    if (window.innerWidth < 900) setSidebarOpen(false);
  }, []);

  const handleSelectSidebarFilter = useCallback((filter: EntryFilter) => {
    setActiveView('reader');
    setTagFilter(null);
    setSearchInput('');
    setAppliedSearchQuery('');
    setSearchAllFeeds(false);
    setSearchStatus('idle');
    setEntryFilter(filter);
    setSelectionMode(false);
    setSelectedIds(new Set());
    if (filter !== 'all') setSelectedFeedId(null);
    if (window.innerWidth < 900) setSidebarOpen(false);
  }, []);

  const handleEntryListFilter = useCallback((filter: EntryFilter) => {
    setActiveView('reader');
    setTagFilter(null);
    setSearchInput('');
    setAppliedSearchQuery('');
    setSearchAllFeeds(false);
    setSearchStatus('idle');
    setEntryFilter(filter);
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const hasNoFeeds = feedLoadStatus === 'success' && feeds.length === 0;
  const visibleEntries = hasNoFeeds ? [] : entries;
  const selectedFeedName = selectedFeed?.title ?? selectedFeed?.feedURL ?? null;
  const listHeading = getEntryListHeadingPresentation({
    feedName: selectedFeedName,
    filter: entryFilter,
    hasActiveSearch: Boolean(appliedSearchQuery),
    tagName: tagFilter?.tagNames[0],
    searchAllFeeds,
  });
  const handleExportRequest = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    const result = await checkAvailability(ids);
    if (!result.ok) return;
    setExportArticles(result.data.articles);
    setShowExportDialog(true);
  }, [selectedIds]);

  const selectedSourceTitle = selectedEntryFeed?.title
    ?? selectedEntryFeed?.feedURL
    ?? '';
  const selectedSearchFeedLabel = selectedFeed
    ? selectedFeed.title ?? selectedFeed.feedURL
    : null;

  return (
    <div
      className={[
        'reader-page',
        sidebarOpen ? 'is-sidebar-open' : 'is-sidebar-closed',
        isReadingFocus ? 'is-reading-focus' : '',
        searchFocused ? 'is-search-active' : '',
        largeType ? 'is-large-type' : '',
        activeView === 'settings' ? 'is-settings-view' : '',
        articleChatOpen ? 'is-article-chat' : '',
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

      <span
        className="article-action-tooltip theme-toggle-tooltip"
        data-tooltip={readerTheme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'}
      >
        <button
          type="button"
          className="icon-button theme-toggle"
          aria-label={readerTheme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'}
          aria-pressed={readerTheme === 'light'}
          onClick={() => setReaderTheme((theme) =>
            theme === 'dark' ? 'light' : 'dark')}
        >
          {readerTheme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </span>

      <div
        ref={workspaceRef}
        className="reader-workspace"
      >
        {articleChatOpen && selectedEntry && (
          <ArticleChatPanel
            entryId={selectedEntry.id}
            entryTitle={selectedEntry.title ?? 'Untitled'}
            onClose={closeArticleChat}
            onActiveRunChange={setActiveArticleChatRun}
            selectionRequest={articleChatSelectionRequest}
            onSelectionConsumed={consumeArticleChatSelection}
          />
        )}
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
            searchFocused={searchFocused}
            searchAllFeeds={searchAllFeeds}
            searchInputRef={searchInputRef}
            onSearchInputChange={setSearchInput}
            onSearchFocus={() => setSearchFocused(true)}
            onSearchAllFeedsChange={setSearchAllFeeds}
            onSelectFilter={handleSelectSidebarFilter}
            onSelectFeed={handleSelectFeed}
            onRefresh={handleSyncAll}
            onLocalRefresh={reloadLocalData}
            onOpenAddFeed={() => setShowAddFeedDialog(true)}
            entryStats={entryStats}
            loading={loadingFeeds}
            feedLoadStatus={feedLoadStatus}
            settingsActive={activeView === 'settings'}
            showTagsView={activeView === 'tags'}
            hasTagFilter={tagFilter !== null}
            onOpenSettings={() => {
              setActiveView('settings');
              setIsReadingFocus(false);
              if (window.innerWidth < 900) setSidebarOpen(false);
            }}
            onOpenTags={handleOpenTags}
          />
        </aside>

        <section
          ref={storyListPaneRef}
          className="story-list-pane"
          aria-label="文章列表"
          onClickCapture={(e) => {
            if (activeView !== 'reader') return;
            const tagEl = (e.target as HTMLElement).closest('.story-card-tag');
            if (tagEl) {
              e.stopPropagation();
              handleSelectTag(tagEl.textContent ?? '');
            }
          }}
        >
          {activeView === 'tags' ? (
            <TagListPage onSelectTag={handleSelectTag} />
          ) : searchFocused ? null : (
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
              onFilterChange={handleEntryListFilter}
              onSelectEntry={handleSelectEntry}
              onLoadMore={handleLoadMore}
              hasMore={hasNoFeeds ? false : hasMoreEntries}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onSelectionModeChange={(enabled: boolean) => {
                if (!enabled) setSelectedIds(new Set());
                setSelectionMode(enabled);
              }}
              onSelectionToggle={(entryId: number) => {
                setSelectedIds((previousIds: Set<number>) => {
                  const nextIds = new Set(previousIds);
                  if (nextIds.has(entryId)) nextIds.delete(entryId);
                  else nextIds.add(entryId);
                  return nextIds;
                });
              }}
            />
          )}
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
              <span
                className="article-action-tooltip"
                data-tooltip={isReadingFocus ? '退出专注阅读' : '进入专注阅读'}
              >
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
              </span>
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
                <div
                  ref={setArticleExportToolbarTarget}
                  className="article-export-slot"
                >
                  {selectionMode && (
                    <span
                      className="article-action-tooltip"
                      data-tooltip={selectedIds.size > 0
                        ? `导出所选 ${selectedIds.size} 篇文章`
                        : '请先选择文章'}
                    >
                      <button
                        type="button"
                        className="type-button article-export-button"
                        aria-label={selectedIds.size > 0
                          ? `导出所选 ${selectedIds.size} 篇文章`
                          : '请先选择文章'}
                        disabled={selectedIds.size === 0}
                        onClick={() => void handleExportRequest()}
                      >
                        <ExportIcon />
                      </button>
                    </span>
                  )}
                </div>
                <ArticleSyncMenu
                  hasEntry={Boolean(selectedEntry)}
                  isRefreshing={refreshingContentEntryId === selectedEntry?.id}
                  onRefreshArticle={handleRefreshContent}
                  onRetranslateArticle={handleRetranslateArticle}
                />
                <span
                  className="article-action-tooltip"
                  data-tooltip={
                    copiedOriginalEntryId === selectedEntry?.id
                      ? '原文链接已复制'
                      : '复制原文链接'
                  }
                >
                  <button
                    type="button"
                    className={`article-toolbar-action article-copy-button${
                      copiedOriginalEntryId === selectedEntry?.id
                        ? ' is-copied'
                        : ''
                    }`}
                    aria-label={
                      copiedOriginalEntryId === selectedEntry?.id
                        ? '原文链接已复制'
                        : '复制原文链接'
                    }
                    disabled={
                      !selectedEntry?.url
                      || copiedOriginalEntryId === selectedEntry.id
                    }
                    onClick={() => void handleCopyOriginal()}
                  >
                    <span className="article-copy-button-default" aria-hidden="true">
                      <CopyIcon />
                    </span>
                    <span className="article-copy-button-success" aria-hidden="true">
                      <CheckIcon />
                    </span>
                  </button>
                </span>
              </div>
            )}
          </div>

          <div className="article-stage">
            {activeView === 'settings' ? (
              <AISettingsPage
                preferences={aiPreferences}
                onPreferencesChange={setAiPreferences}
                readerPreferences={readerPreferences}
                onReaderPreferencesChange={setReaderPreferences}
                onClose={() => setActiveView('reader')}
              />
            ) : (
              <EntryDetail
                entry={selectedEntry}
                contentRefreshVersion={
                  selectedEntry
                    ? contentRefreshVersions[selectedEntry.id] ?? 0
                    : 0
                }
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
                exportToolbarTarget={articleExportToolbarTarget}
                onAIViewStateChange={handleEntryAIViewStateChange}
                onReadingProgressChange={handleReadingProgressChange}
                onContentRefreshComplete={handleContentRefreshComplete}
                retranslationRequest={retranslationRequest ?? undefined}
                onRetranslationRequestComplete={handleRetranslationRequestComplete}
                beforeTranslationStart={requestTranslationSetupNotice}
                selectionMode={selectionMode}
                selectedIds={selectedIds}
                onTagsChanged={() => {
                  void loadEntryStats();
                  void requestEntries(undefined, false);
                }}
                onExportRequest={handleExportRequest}
                onFeedback={setReaderFeedback}
                pageTurnAnimationEnabled={
                  readerPreferences.pageTurnAnimationEnabled
                }
                articleChatOpen={articleChatOpen}
                onArticleChatToggle={
                  articleChatOpen ? closeArticleChat : openArticleChat
                }
                onArticleChatSelection={openArticleChatForSelection}
              />
            )}
          </div>
        </main>
        <SearchOverlay
          visible={searchFocused}
          searchInput={searchInput}
          searchStatus={effectiveSearchStatus}
          searchAllFeeds={searchAllFeeds}
          searchInputRef={searchInputRef}
          onSearchInputChange={setSearchInput}
          onSearchAllFeedsChange={setSearchAllFeeds}
          onClose={() => setSearchFocused(false)}
          selectedSearchFeedLabel={selectedSearchFeedLabel}
        >
          {searchFocused && (
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
              onFilterChange={handleEntryListFilter}
              onSelectEntry={handleSelectEntry}
              onLoadMore={handleLoadMore}
              hasMore={hasNoFeeds ? false : hasMoreEntries}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onSelectionModeChange={(enabled: boolean) => {
                if (!enabled) setSelectedIds(new Set());
                setSelectionMode(enabled);
              }}
              onSelectionToggle={(entryId: number) => {
                setSelectedIds((previousIds: Set<number>) => {
                  const nextIds = new Set(previousIds);
                  if (nextIds.has(entryId)) nextIds.delete(entryId);
                  else nextIds.add(entryId);
                  return nextIds;
                });
              }}
            />
          )}
        </SearchOverlay>
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

      <TranslationSetupNoticeDialog
        open={showTranslationSetupNotice}
        onConfirm={handleTranslationSetupNoticeConfirm}
      />

      <TranslationNoticeDialog
        message={retranslationNotice}
        onConfirm={() => setRetranslationNotice(null)}
      />

      {showExportDialog && exportArticles.length > 0 && (
        <ExportOptionsDialog
          open={showExportDialog}
          articles={exportArticles}
          onCancel={() => setShowExportDialog(false)}
          onConfirm={async (perArticleOptions) => {
            setShowExportDialog(false);
            const exportEntries = Array.from(perArticleOptions.entries()).map(
              ([entryId, options]) => ({ entryId, options }),
            );
            const result = await exportMultipleEntries(exportEntries);
            if (result.ok) {
              setSelectionMode(false);
              setSelectedIds(new Set());
              setReaderFeedback('Markdown 文档已成功导出。');
            }
          }}
        />
      )}
    </div>
  );
};
