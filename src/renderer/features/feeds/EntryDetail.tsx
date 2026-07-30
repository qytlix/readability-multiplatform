import {
  useCallback,
  useState,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent,
  type UIEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { CleanedContent } from '../../../shared/contracts/content.types';
import type { Entry } from '../../../shared/contracts/feed.types';
import {
  getReaderDisplayState,
  type EntryLoadStatus,
  type FeedLoadStatus,
} from './readerState';
import {
  getFloatingReaderHeaderAction,
  shouldRevealFloatingReaderHeaderAtWindowTop,
} from './readerHeaderVisibility';
import {
  SummaryPanel,
  type SummaryPanelHandle,
} from '../summary/SummaryPanel';
import {
  TranslationPanel,
  type TranslationPanelHandle,
  type TranslationControlState,
  type RetranslationRequestResult,
  type RetranslationStatus,
} from '../translation/TranslationPanel';
import type { AiPreferences } from '../settings/aiPreferences';
import { InlineTranslationOverlay } from '../translation/InlineTranslationOverlay';
import {
  ChatIcon,
  SummaryIcon,
  TranslateIcon,
  ExportIcon,
  TagIcon,
} from '../reader/ReaderIcons';
import { formatArticleDate, getArticleDateLocale } from './articleMetadata';
import {
  checkAvailability,
  exportSingleEntry,
} from './entryExport';
import { ExportOptionsDialog } from './ExportOptionsDialog';
import type {
  ArticleAvailability,
  PerArticleOptions,
} from '../../../shared/contracts/export.types';
import type { EntryAIViewState } from './entryAIViewState';
import {
  calculateReadingProgress,
  getScrollTopForReadingProgress,
} from './readingProgress';
import { ReadingProgressBook } from './ReadingProgressBook';
import {
  getReadingBookTurnDirection,
  getReadingBookTurnDuration,
  getReadingBookTurnVariant,
  SINGLE_PAGE_SCROLL_DISTANCE_PX,
  type ReadingBookTurnDirection,
  type ReadingBookTurnMotion,
} from './readingProgressBookMotion';
import {
  getNativeVideoHtml,
  getTrustedVideoEmbed,
} from './trustedVideoEmbed';
import { AnnotatedArticle } from '../annotations/AnnotatedArticle';
import { TagFloatingWindow } from '../tags/TagFloatingWindow';
import type { ChatSelectionContext } from '../../../shared/contracts/chat.types';
import { ArticleChatSelectionMenu } from '../chat/ArticleChatSelectionMenu';

interface EntryDetailProps {
  entry: Entry | null;
  contentRefreshVersion?: number;
  aiViewState: EntryAIViewState;
  feedLoadStatus: FeedLoadStatus;
  feedLoadError: string;
  feedCount: number;
  entryLoadStatus: EntryLoadStatus;
  entryLoadError: string;
  entryCount: number;
  onAddFeed: () => void;
  onRetryFeeds: () => void;
  onRetryEntries: () => void;
  aiPreferences: AiPreferences;
  aiToolbarTarget: HTMLDivElement | null;
  exportToolbarTarget?: HTMLDivElement | null;
  onAIViewStateChange: (
    entryId: number,
    change: Partial<EntryAIViewState>,
  ) => void;
  onReadingProgressChange: (entryId: number, readingProgress: number) => Promise<void>;
  onContentRefreshComplete?: (
    entryId: number,
    result: { ok: true } | { ok: false; message: string },
  ) => void;
  retranslationRequest?: { entryId: number; version: number };
  onRetranslationRequestComplete?: (
    entryId: number,
    result: RetranslationRequestResult,
  ) => void;
  onTagsChanged?: () => void;
  beforeTranslationStart?: () => boolean | Promise<boolean>;
  selectionMode?: boolean;
  selectedIds?: Set<number>;
  onExportRequest?: () => void;
  onFeedback?: (message: string) => void;
  pageTurnAnimationEnabled?: boolean;
  articleChatOpen?: boolean;
  onArticleChatToggle?: () => void;
  onArticleChatSelection?: (selection: ChatSelectionContext) => void;
}

type LoadStatus = 'idle' | 'loading' | 'success' | 'error';

const WINDOW_TOP_REVEAL_ZONE = 60;
const BOOK_SCROLL_GESTURE_IDLE_MS = 180;

export const EntryDetail = ({
  entry,
  contentRefreshVersion = 0,
  aiViewState,
  feedLoadStatus,
  feedLoadError,
  feedCount,
  entryLoadStatus,
  entryLoadError,
  entryCount,
  onAddFeed,
  onRetryFeeds,
  onRetryEntries,
  aiPreferences,
  aiToolbarTarget,
  exportToolbarTarget = null,
  onAIViewStateChange,
  selectionMode = false,
  selectedIds,
  onExportRequest,
  onFeedback,
  onReadingProgressChange,
  onContentRefreshComplete,
  retranslationRequest,
  onRetranslationRequestComplete,
  beforeTranslationStart,
  onTagsChanged,
  pageTurnAnimationEnabled = true,
  articleChatOpen = false,
  onArticleChatToggle,
  onArticleChatSelection,
}: EntryDetailProps) => {
  const [content, setContent] = useState<CleanedContent | null>(null);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [error, setError] = useState('');
  const [linkError, setLinkError] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [isSummaryGenerating, setIsSummaryGenerating] = useState(false);
  const [isTranslationGenerating, setIsTranslationGenerating] = useState(false);
  const [translationControlState, setTranslationControlState] =
    useState<TranslationControlState | null>(null);
  const [retranslationStatus, setRetranslationStatus] = useState<RetranslationStatus | null>(null);
  const [isTitleTranslating, setIsTitleTranslating] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showTagWindow, setShowTagWindow] = useState(false);
  const [exportArticleAvail, setExportArticleAvail] = useState<ArticleAvailability | null>(null);
  const [titleTranslationTarget, setTitleTranslationTarget] = useState<HTMLDivElement | null>(null);
  const [isFloatingHeaderVisible, setIsFloatingHeaderVisible] = useState(false);
  const [visibleReadingProgress, setVisibleReadingProgress] = useState(
    entry?.readingProgress ?? 0,
  );
  const [readingBookTurn, setReadingBookTurn] =
    useState<ReadingBookTurnMotion | null>(null);
  const [readingJumpTarget, setReadingJumpTarget] =
    useState<'start' | 'end'>('end');
  const prevEntryId = useRef<number | null>(null);
  const handledRefreshVersionsRef = useRef(new Map<number, number>());
  const handledRetranslationRequestRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const flowHeaderRef = useRef<HTMLDivElement>(null);
  const summaryPanelRef = useRef<SummaryPanelHandle>(null);
  const translationPanelRef = useRef<TranslationPanelHandle>(null);
  const currentScrollTopRef = useRef(0);
  const previousScrollTopRef = useRef(0);
  const isFloatingHeaderHoveredRef = useRef(false);
  const progressSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingProgressRef = useRef<{ entryId: number; readingProgress: number } | null>(null);
  const lastReportedProgressRef = useRef<number | null>(null);
  const restoredEntryIdRef = useRef<number | null>(null);
  const isRestoringProgressRef = useRef(false);
  const hasUserScrolledSinceRestoreRef = useRef(false);
  const programmaticScrollRef = useRef<{ entryId: number; scrollTop: number } | null>(null);
  const readingBookTurnIdRef = useRef(0);
  const tagBtnRef = useRef<HTMLButtonElement>(null);
  const lastReadingBookSampleAtRef = useRef<number | null>(null);
  const readingBookDirectionRef = useRef<ReadingBookTurnDirection | null>(null);
  const readingBookDistanceRef = useRef(0);

  useEffect(() => {
    if (pageTurnAnimationEnabled) return;

    setReadingBookTurn(null);
    lastReadingBookSampleAtRef.current = null;
    readingBookDirectionRef.current = null;
    readingBookDistanceRef.current = 0;
  }, [pageTurnAnimationEnabled]);

  const readerDisplayState = getReaderDisplayState({
    feedLoadStatus,
    feedCount,
    entryLoadStatus,
    entryCount,
    hasSelectedEntry: entry !== null,
  });
  const trustedVideoEmbed = useMemo(
    () => getTrustedVideoEmbed(
      entry?.url ?? content?.sourceUrl,
      content?.html,
    ),
    [content?.html, content?.sourceUrl, entry?.url],
  );
  const nativeVideoHtml = useMemo(
    () => getNativeVideoHtml(content?.cleanedHtml),
    [content?.cleanedHtml],
  );
  const hasArticleVideo = trustedVideoEmbed !== null || nativeVideoHtml !== null;
  const isTranslationReady = status === 'success'
    && content?.isPreview !== true
    && !hasArticleVideo
    && Boolean(content?.cleanedHtml.trim());
  const handleSummaryVisibleChange = useCallback((summaryVisible: boolean): void => {
    if (!entry) return;
    onAIViewStateChange(entry.id, { summaryVisible });
  }, [entry?.id, onAIViewStateChange]);
  const handleBilingualChange = useCallback((translationVisible: boolean): void => {
    if (!entry) return;
    onAIViewStateChange(entry.id, { translationVisible });
  }, [entry?.id, onAIViewStateChange]);
  const handleRetranslationStatusChange = useCallback((next: RetranslationStatus | null): void => {
    setRetranslationStatus(next);
  }, []);
  const handleTranslationControlStateChange = useCallback((
    next: TranslationControlState | null,
  ): void => {
    setTranslationControlState(next);
  }, []);

  const flushReadingProgress = useCallback((): void => {
    if (progressSaveTimerRef.current !== null) {
      clearTimeout(progressSaveTimerRef.current);
      progressSaveTimerRef.current = null;
    }
    const pendingProgress = pendingProgressRef.current;
    pendingProgressRef.current = null;
    if (pendingProgress) {
      void onReadingProgressChange(
        pendingProgress.entryId,
        pendingProgress.readingProgress,
      );
    }
  }, [onReadingProgressChange]);

  useEffect(() => {
    if (!entry) {
      prevEntryId.current = null;
      setContent(null);
      setStatus('idle');
      setLinkError('');
      return;
    }

    const handledRefreshVersion =
      handledRefreshVersionsRef.current.get(entry.id) ?? 0;
    const forceRefresh = contentRefreshVersion > handledRefreshVersion;
    if (forceRefresh) {
      handledRefreshVersionsRef.current.set(entry.id, contentRefreshVersion);
    }

    // Abort any in-flight request for previous entry (P2-#10: race condition fix)
    if (abortRef.current) {
      abortRef.current.abort();
    }

    // Avoid re-fetching same entry
    if (prevEntryId.current === entry.id && !forceRefresh) return;
    prevEntryId.current = entry.id;

    const loadContent = async () => {
      setContent(null);
      setStatus('loading');
      setError('');
      setLinkError('');
      abortRef.current = new AbortController();
      let showingPreview = false;

      try {
        // First check if content already exists
        if (!forceRefresh) {
          const existingResult = await window.shaleAPI.content.get(entry.id);
          if (!existingResult.ok) {
            // IPC-level error (not "no content")
            setStatus('error');
            setError(existingResult.error?.message ?? 'Failed to check existing content');
            return;
          }

          const existingContent = existingResult.data;
          const hasRenderableCachedContent =
            existingContent?.pipelineStatus === 'success'
            && (
              existingContent.cleanedHtml.trim().length > 0
              || Boolean(existingContent.html?.trim())
            );
          if (existingContent && hasRenderableCachedContent) {
            setContent(existingContent);
            setStatus('success');
            if (!existingContent.isPreview) return;
            showingPreview = true;
          }
        }

        // No existing content (null) — fetch and clean
        const fetchResult = await window.shaleAPI.content.fetchAndClean(entry.id);
        if (!fetchResult.ok) {
          const message = fetchResult.error?.message ?? 'Failed to fetch content';
          if (showingPreview) return;
          setStatus('error');
          setError(message);
          if (forceRefresh) {
            onContentRefreshComplete?.(entry.id, { ok: false, message });
          }
          return;
        }
        if (fetchResult.data.pipelineStatus !== 'success') {
          const message =
            fetchResult.data.pipelineError ?? 'Failed to extract article content';
          if (showingPreview) return;
          setStatus('error');
          setError(message);
          if (forceRefresh) {
            onContentRefreshComplete?.(entry.id, { ok: false, message });
          }
          return;
        }
        setContent(fetchResult.data);
        setStatus('success');
        if (forceRefresh) {
          onContentRefreshComplete?.(entry.id, { ok: true });
        }
      } catch (err: unknown) {
        // Ignore abort errors
        if (err instanceof Error && err.name === 'AbortError') return;
        if (showingPreview) return;
        const message =
          err instanceof Error ? err.message : 'Failed to load content';
        setStatus('error');
        setError(message);
        if (forceRefresh) {
          onContentRefreshComplete?.(entry.id, { ok: false, message });
        }
      }
    };

    loadContent();

    return () => {
      // Cleanup: abort in-flight request on unmount
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [
    contentRefreshVersion,
    entry?.id,
    onContentRefreshComplete,
  ]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    isRestoringProgressRef.current = entry !== null;
    if (container && entry) {
      programmaticScrollRef.current = { entryId: entry.id, scrollTop: 0 };
      container.scrollTop = 0;
      programmaticScrollRef.current.scrollTop = container.scrollTop;
    } else {
      programmaticScrollRef.current = null;
      if (container) container.scrollTop = 0;
    }
    currentScrollTopRef.current = 0;
    previousScrollTopRef.current = 0;
    lastReportedProgressRef.current = entry?.readingProgress ?? null;
    restoredEntryIdRef.current = null;
    hasUserScrolledSinceRestoreRef.current = false;
    isFloatingHeaderHoveredRef.current = false;
    setIsFloatingHeaderVisible(false);
    setShowRaw(false);
    setIsSummaryGenerating(false);
    setIsTranslationGenerating(false);
    setTranslationControlState(null);
    setRetranslationStatus(null);
    setIsTitleTranslating(false);
    setVisibleReadingProgress(entry?.readingProgress ?? 0);
    setReadingBookTurn(null);
    setReadingJumpTarget('end');
    lastReadingBookSampleAtRef.current = null;
    readingBookDirectionRef.current = null;
    readingBookDistanceRef.current = 0;
  }, [entry?.id]);

  useEffect(() => {
    if (
      !entry
      || !retranslationRequest
      || retranslationRequest.entryId !== entry.id
      || handledRetranslationRequestRef.current === retranslationRequest.version
    ) {
      return;
    }
    handledRetranslationRequestRef.current = retranslationRequest.version;
    const requestRetranslation = async (): Promise<void> => {
      const result = !isTranslationReady
        ? 'content-unavailable' as const
        : await translationPanelRef.current?.requestRetranslation()
          ?? 'failed';
      onRetranslationRequestComplete?.(entry.id, result);
    };
    void requestRetranslation();
  }, [
    entry?.id,
    isTranslationReady,
    onRetranslationRequestComplete,
    retranslationRequest,
  ]);

  useEffect(() => () => {
    flushReadingProgress();
  }, [entry?.id, flushReadingProgress]);

  useEffect(() => {
    if (
      !entry
      || readerDisplayState !== 'article'
      || status !== 'success'
      || !content
      || content.isPreview
      || restoredEntryIdRef.current === entry.id
    ) {
      return;
    }

    const entryId = entry.id;
    const savedReadingProgress = entry.readingProgress;
    if (savedReadingProgress >= 1) {
      restoredEntryIdRef.current = entryId;
      isRestoringProgressRef.current = false;
      return;
    }

    let secondFrame = 0;
    let restoreFrame = 0;
    let releaseFrame = 0;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;

    const releaseRestoration = (): void => {
      if (restoredEntryIdRef.current === entryId) {
        isRestoringProgressRef.current = false;
      }
    };

    const restoreSavedPosition = (): void => {
      if (hasUserScrolledSinceRestoreRef.current) return;
      const container = scrollContainerRef.current;
      if (!container) {
        isRestoringProgressRef.current = false;
        return;
      }

      isRestoringProgressRef.current = true;
      const restoredScrollTop = getScrollTopForReadingProgress(
        savedReadingProgress,
        container.scrollHeight,
        container.clientHeight,
      );
      programmaticScrollRef.current = {
        entryId,
        scrollTop: restoredScrollTop,
      };
      container.scrollTop = restoredScrollTop;
      programmaticScrollRef.current.scrollTop = container.scrollTop;
      currentScrollTopRef.current = restoredScrollTop;
      previousScrollTopRef.current = restoredScrollTop;
      lastReportedProgressRef.current = savedReadingProgress;
      restoredEntryIdRef.current = entryId;
      setVisibleReadingProgress(calculateReadingProgress({
        scrollTop: restoredScrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
      }));

      if (releaseFrame) window.cancelAnimationFrame(releaseFrame);
      releaseFrame = window.requestAnimationFrame(releaseRestoration);
    };

    const scheduleRestore = (): void => {
      if (hasUserScrolledSinceRestoreRef.current) return;
      if (restoreFrame) window.cancelAnimationFrame(restoreFrame);
      restoreFrame = window.requestAnimationFrame(restoreSavedPosition);
    };

    const observeCurrentContent = (container: HTMLDivElement): void => {
      if (!resizeObserver) return;
      resizeObserver.disconnect();
      Array.from(container.children).forEach((child) => {
        resizeObserver?.observe(child);
      });
    };

    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const container = scrollContainerRef.current;
        if (!container || restoredEntryIdRef.current === entry.id) {
          isRestoringProgressRef.current = false;
          return;
        }

        restoreSavedPosition();

        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(scheduleRestore);
          observeCurrentContent(container);
        }
        if (typeof MutationObserver !== 'undefined') {
          mutationObserver = new MutationObserver(() => {
            observeCurrentContent(container);
            scheduleRestore();
          });
          mutationObserver.observe(container, {
            childList: true,
            subtree: true,
          });
        }
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      if (restoreFrame) window.cancelAnimationFrame(restoreFrame);
      if (releaseFrame) window.cancelAnimationFrame(releaseFrame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      isRestoringProgressRef.current = false;
    };
  }, [
    content,
    entry?.id,
    entry?.readingProgress,
    readerDisplayState,
    status,
  ]);

  useEffect(() => {
    const revealHeaderAtWindowTop = (event: globalThis.MouseEvent): void => {
      if (shouldRevealFloatingReaderHeaderAtWindowTop({
        pointerY: event.clientY,
        revealZoneHeight: WINDOW_TOP_REVEAL_ZONE,
        currentScrollTop: currentScrollTopRef.current,
        headerHeight: flowHeaderRef.current?.offsetHeight ?? 0,
      })) {
        setIsFloatingHeaderVisible(true);
      }
    };

    window.addEventListener('mousemove', revealHeaderAtWindowTop);
    return () => window.removeEventListener('mousemove', revealHeaderAtWindowTop);
  }, []);

  const handleExportClick = useCallback(async (): Promise<void> => {
    if (selectionMode && selectedIds && selectedIds.size > 0) {
      onExportRequest?.();
      return;
    }
    if (!entry) return;
    const result = await checkAvailability([entry.id]);
    if (!result.ok) {
      return;
    }
    const avail = result.data.articles[0];
    if (!avail) return;
    setExportArticleAvail(avail);
    setShowExportDialog(true);
  }, [entry, selectionMode, selectedIds, onExportRequest]);

  const handleExportConfirm = useCallback(
    async (perArticleOptions: Map<number, PerArticleOptions>): Promise<void> => {
      setShowExportDialog(false);
      if (!entry) return;
      const options = perArticleOptions.get(entry.id);
      if (!options) return;
      const result = await exportSingleEntry(entry.id, options);
      if (result.ok) {
        onFeedback?.('Markdown 文档已成功导出。');
      }
    },
    [entry, onFeedback],
  );

  const handleExportCancel = useCallback((): void => {
    setShowExportDialog(false);
  }, []);



  if (readerDisplayState === 'feed-loading') {
    return <div className="entry-detail empty entry-detail-empty-state">正在载入订阅源…</div>;
  }

  if (readerDisplayState === 'feed-error') {
    return (
      <div className="entry-detail empty entry-detail-empty-state">
        <div className="entry-detail-empty-message">
          <h2>订阅源载入失败</h2>
          <p>{feedLoadError}</p>
          <button type="button" className="reader-empty-action" onClick={onRetryFeeds}>
            重试
          </button>
        </div>
      </div>
    );
  }

  if (readerDisplayState === 'no-feeds') {
    return (
      <div className="entry-detail empty entry-detail-empty-state">
        <div className="entry-detail-empty-message">
          <h2>添加第一个订阅源</h2>
          <p>订阅 RSS 或 Atom Feed，开始建立你的本地资料库。</p>
          <button type="button" className="reader-empty-action" onClick={onAddFeed}>
            <span aria-hidden="true">＋</span>
            添加订阅
          </button>
        </div>
      </div>
    );
  }

  if (readerDisplayState === 'entries-loading') {
    return <div className="entry-detail empty entry-detail-empty-state">正在载入文章…</div>;
  }

  if (readerDisplayState === 'entries-error') {
    return (
      <div className="entry-detail empty entry-detail-empty-state">
        <div className="entry-detail-empty-message">
          <h2>文章载入失败</h2>
          <p>{entryLoadError}</p>
          <button type="button" className="reader-empty-action" onClick={onRetryEntries}>
            重试
          </button>
        </div>
      </div>
    );
  }

  if (readerDisplayState === 'no-articles') {
    return (
      <div className="entry-detail empty entry-detail-empty-state">
        <div className="entry-detail-empty-message">
          <h2>还没有文章</h2>
          <p>同步订阅源后，新文章会出现在这里。</p>
        </div>
      </div>
    );
  }

  if (readerDisplayState === 'no-selection') {
    return (
      <div className="entry-detail empty entry-detail-empty-selection">
        <div className="entry-detail-empty-content">
          <p className="entry-detail-empty-primary">选择一篇文章开始阅读</p>
          <p className="entry-detail-empty-secondary">让想法慢慢沉淀。</p>
        </div>
      </div>
    );
  }

  if (!entry) return null;

  const openExternalLink = async (url: string, baseUrl?: string): Promise<void> => {
    setLinkError('');

    try {
      const result = await window.shaleAPI.external.open({ url, baseUrl });
      if (!result.ok) {
        setLinkError(result.error.message);
      }
    } catch {
      setLinkError('Unable to open this link in your default browser.');
    }
  };

  const isPlainPrimaryClick = (event: MouseEvent<HTMLElement>): boolean =>
    event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey;

  const handleExternalAnchorClick = (
    event: MouseEvent<HTMLAnchorElement>,
    url: string,
    baseUrl?: string,
  ): void => {
    event.preventDefault();
    if (isPlainPrimaryClick(event)) {
      void openExternalLink(url, baseUrl);
    }
  };

  const handleContentClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const anchor = target.closest('a[href]');
    if (!anchor || !event.currentTarget.contains(anchor)) return;

    const href = anchor.getAttribute('href');
    if (!href) return;

    if (href.trim().startsWith('#')) {
      event.preventDefault();
      window.location.hash = href.trim();
      return;
    }

    event.preventDefault();
    if (isPlainPrimaryClick(event)) {
      void openExternalLink(href, content?.sourceUrl || entry.url);
    }
  };

  const handleReaderScroll = (event: UIEvent<HTMLDivElement>): void => {
    const currentScrollTop = event.currentTarget.scrollTop;
    const previousScrollTop = previousScrollTopRef.current;
    const scrollDelta = currentScrollTop - previousScrollTop;
    const action = getFloatingReaderHeaderAction({
      currentScrollTop,
      previousScrollTop,
      headerHeight: flowHeaderRef.current?.offsetHeight ?? 0,
      isHeaderHovered: isFloatingHeaderHoveredRef.current,
    });
    currentScrollTopRef.current = currentScrollTop;
    previousScrollTopRef.current = currentScrollTop;

    if (action === 'show') {
      setIsFloatingHeaderVisible(true);
    } else if (action === 'hide') {
      setIsFloatingHeaderVisible(false);
    }

    const programmaticScroll = programmaticScrollRef.current;
    if (
      !hasUserScrolledSinceRestoreRef.current
      && programmaticScroll?.entryId === entry.id
    ) {
      return;
    }

    if (
      isRestoringProgressRef.current
      || status !== 'success'
      || !content
      || content.isPreview
    ) {
      return;
    }
    programmaticScrollRef.current = null;
    hasUserScrolledSinceRestoreRef.current = true;

    const readingProgress = calculateReadingProgress({
      scrollTop: currentScrollTop,
      scrollHeight: event.currentTarget.scrollHeight,
      clientHeight: event.currentTarget.clientHeight,
    });
    setVisibleReadingProgress(readingProgress);

    const turnDirection = getReadingBookTurnDirection(scrollDelta);
    if (turnDirection) {
      setReadingJumpTarget(turnDirection === 'left' ? 'end' : 'start');
    }
    if (turnDirection && pageTurnAnimationEnabled) {
      const sampleAt = event.timeStamp;
      const previousSampleAt = lastReadingBookSampleAtRef.current;
      const elapsedSinceSample = previousSampleAt === null
        ? 120
        : Math.max(1, sampleAt - previousSampleAt);
      const directionChanged = readingBookDirectionRef.current !== null
        && readingBookDirectionRef.current !== turnDirection;
      const isNewGesture = previousSampleAt === null
        || elapsedSinceSample >= BOOK_SCROLL_GESTURE_IDLE_MS
        || directionChanged;

      if (isNewGesture) {
        readingBookDistanceRef.current = 0;
      }
      readingBookDistanceRef.current += Math.abs(scrollDelta);
      lastReadingBookSampleAtRef.current = sampleAt;
      readingBookDirectionRef.current = turnDirection;

      if (
        isNewGesture
        || readingBookDistanceRef.current >= SINGLE_PAGE_SCROLL_DISTANCE_PX
      ) {
        const turnDistance = readingBookDistanceRef.current;
        readingBookTurnIdRef.current += 1;
        setReadingBookTurn({
          id: readingBookTurnIdRef.current,
          direction: turnDirection,
          durationMs: getReadingBookTurnDuration(
            scrollDelta,
            elapsedSinceSample,
          ),
          variant: getReadingBookTurnVariant(turnDistance),
        });
        readingBookDistanceRef.current = 0;
      }
    }

    const lastReportedProgress = lastReportedProgressRef.current;
    if (
      lastReportedProgress !== null
      && (
        readingProgress === lastReportedProgress
        || (
          readingProgress !== 1
          && Math.abs(readingProgress - lastReportedProgress) < 0.002
        )
      )
    ) {
      return;
    }

    lastReportedProgressRef.current = readingProgress;
    pendingProgressRef.current = {
      entryId: entry.id,
      readingProgress,
    };
    if (progressSaveTimerRef.current !== null) {
      clearTimeout(progressSaveTimerRef.current);
    }
    if (readingProgress === 1) {
      flushReadingProgress();
      return;
    }
    progressSaveTimerRef.current = setTimeout(() => {
      flushReadingProgress();
    }, 250);
  };

  const handleReaderScrollIntent = (): void => {
    if (status !== 'success' || !content || content.isPreview) return;
    hasUserScrolledSinceRestoreRef.current = true;
    isRestoringProgressRef.current = false;
    programmaticScrollRef.current = null;
  };

  const handleReadingJump = (): void => {
    const container = scrollContainerRef.current;
    if (!container) return;

    handleReaderScrollIntent();
    const top = readingJumpTarget === 'start'
      ? 0
      : Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTo({ top, behavior: 'smooth' });
  };

  const isPreview = content?.isPreview === true;
  const isSummaryReady = status === 'success'
    && !isPreview
    && !hasArticleVideo
    && Boolean(content?.markdown.trim());
  const isArticleChatReady = status === 'success'
    && !isPreview
    && Boolean(content?.markdown.trim());
  const articleDateLocale = getArticleDateLocale(
    entry.title,
    content?.markdown ?? entry.summary,
  );
  const currentRetranslationStatus = retranslationStatus
    && retranslationStatus.entryId === entry.id
    && retranslationStatus.sourceLanguage === aiPreferences.translationSourceLanguage
    && retranslationStatus.targetLanguage === aiPreferences.translationTargetLanguage
    && retranslationStatus.useTerminology === aiPreferences.useTerminology
    && retranslationStatus.useSmartContext === aiPreferences.useSmartContext
    && retranslationStatus.expertId === aiPreferences.translationExpertId
    ? retranslationStatus
    : null;
  const currentTranslationControlState = translationControlState
    && translationControlState.entryId === entry.id
    && translationControlState.sourceLanguage === aiPreferences.translationSourceLanguage
    && translationControlState.targetLanguage === aiPreferences.translationTargetLanguage
    && translationControlState.useTerminology === aiPreferences.useTerminology
    && translationControlState.useSmartContext === aiPreferences.useSmartContext
    && translationControlState.expertId === aiPreferences.translationExpertId
    ? translationControlState
    : null;
  const translationButtonLabel = currentRetranslationStatus?.state === 'running'
    ? '暂停重新翻译'
    : currentRetranslationStatus?.state === 'paused'
      ? '继续重新翻译'
      : currentTranslationControlState?.state === 'running'
        ? '暂停翻译'
          : currentTranslationControlState?.state === 'paused'
          ? '继续翻译'
          : currentTranslationControlState?.hasCompleteTranslation
            ? aiViewState.translationVisible ? '隐藏译文' : '显示译文'
            : '翻译或切换双语视图';

  const activateSummary = (fromFloatingHeader: boolean): void => {
    summaryPanelRef.current?.activate();
    if (fromFloatingHeader) {
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      setIsFloatingHeaderVisible(false);
    }
  };

  const activateTranslation = (): void => {
    translationPanelRef.current?.activate();
  };

  const renderArticleHeader = (floating = false) => (
    <div
      ref={floating ? undefined : flowHeaderRef}
      className={`entry-detail-header${floating ? ' entry-detail-header-floating' : ''}${
        floating && isFloatingHeaderVisible ? ' is-visible' : ''
      }`}
      aria-hidden={floating || undefined}
      onMouseEnter={floating ? () => {
        isFloatingHeaderHoveredRef.current = true;
        setIsFloatingHeaderVisible(true);
      } : undefined}
      onMouseLeave={floating ? () => {
        isFloatingHeaderHoveredRef.current = false;
        setIsFloatingHeaderVisible(false);
      } : undefined}
    >
      <div className="entry-detail-title-row">
        <h2 data-inline-translation-root>
          {entry.title ?? 'Untitled'}
          {isTitleTranslating && (
            <span
              className="translation-segment-spinner"
              role="img"
              aria-label="Translating the article title"
            />
          )}
        </h2>
      </div>
      <div className="entry-detail-meta">
        {entry.author && <span className="entry-detail-author">{entry.author}</span>}
        {entry.publishedAt && (
          <span className="entry-detail-date">
            {formatArticleDate(entry.publishedAt, articleDateLocale)}
          </span>
        )}
      </div>
    </div>
  );

  const summaryTooltip = '总结';
  const translationTooltip = '翻译';

  const aiToolbar = aiToolbarTarget
    ? createPortal(
      <div className="entry-detail-ai-actions" aria-label="AI reading aids">
        <span
          className="article-action-tooltip"
          data-tooltip={summaryTooltip}
        >
          <button
            type="button"
            className={aiViewState.summaryVisible ? 'is-active' : ''}
            aria-label={isSummaryGenerating ? '正在生成摘要' : '生成或显示摘要'}
            aria-controls="summary-result"
            aria-expanded={aiViewState.summaryVisible}
            aria-busy={isSummaryGenerating}
            disabled={!isSummaryReady || isSummaryGenerating}
            onClick={() => activateSummary(true)}
          >
            <SummaryIcon />
          </button>
        </span>
        <span
          className="article-action-tooltip"
          data-tooltip={translationTooltip}
        >
          <button
            type="button"
            className={aiViewState.translationVisible ? 'is-active' : ''}
            aria-label={translationButtonLabel}
            aria-pressed={aiViewState.translationVisible}
            disabled={!isTranslationReady}
            onClick={activateTranslation}
            aria-busy={isTranslationGenerating}
          >
            <TranslateIcon />
          </button>
        </span>
        <span
          className="article-action-tooltip"
          data-tooltip="标签"
        >
          <button
            ref={tagBtnRef}
            type="button"
            className={showTagWindow ? 'is-active' : ''}
            aria-label="管理标签"
            aria-haspopup="dialog"
            aria-expanded={showTagWindow}
            onClick={() => {
              if (showTagWindow) {
                tagBtnRef.current?.blur();
              }
              setShowTagWindow(!showTagWindow);
            }}
          >
            <TagIcon />
          </button>
        </span>
        <span
          className="article-action-tooltip"
          data-tooltip="问答"
        >
          <button
            type="button"
            className={articleChatOpen ? 'is-active' : ''}
            aria-label={articleChatOpen ? '关闭 AI 问答' : '打开 AI 问答'}
            aria-pressed={articleChatOpen}
            disabled={!isArticleChatReady || !onArticleChatToggle}
            onClick={onArticleChatToggle}
          >
            <ChatIcon />
          </button>
        </span>
        {currentRetranslationStatus && (
          <RetranslationStatusNotice status={currentRetranslationStatus} />
        )}
      </div>,
      aiToolbarTarget,
    )
    : null;

  const isExportDisabled = selectionMode && selectedIds && selectedIds.size > 0
    ? false
    : status !== 'success' || isPreview || !content?.markdown.trim();

  const exportTooltip = selectionMode && selectedIds && selectedIds.size > 0
    ? `导出所选 ${selectedIds.size} 篇文章`
    : status !== 'success' || isPreview || !content?.markdown.trim()
      ? '文章尚未完成内容清洗'
      : '导出为 Markdown';

  const exportToolbar = exportToolbarTarget && !selectionMode
    ? createPortal(
      <span
        className="article-action-tooltip"
        data-tooltip={exportTooltip}
      >
        <button
          type="button"
          className="type-button article-export-button"
          aria-label={exportTooltip}
          disabled={isExportDisabled}
          onClick={() => void handleExportClick()}
        >
          <ExportIcon />
        </button>
      </span>,
      exportToolbarTarget,
    )
    : null;

  return (
    <>
      {aiToolbar}
      {exportToolbar}
      {showTagWindow && entry && tagBtnRef.current && (
        <TagFloatingWindow
          entryId={entry.id}
          anchorEl={tagBtnRef.current}
          onClose={() => setShowTagWindow(false)}
          onTagsChanged={onTagsChanged}
          maxCandidates={aiPreferences.tagAgentMaxCandidates}
          tagSuggestionMaxCount={aiPreferences.tagSuggestionMaxCount}
        />
      )}
      <div className="entry-detail">
        <div
          ref={scrollContainerRef}
          className="entry-detail-scroll"
          onScroll={handleReaderScroll}
          onWheelCapture={handleReaderScrollIntent}
          onTouchStartCapture={handleReaderScrollIntent}
          onPointerDownCapture={handleReaderScrollIntent}
          onKeyDownCapture={handleReaderScrollIntent}
        >
          {renderArticleHeader()}
          <div
            ref={setTitleTranslationTarget}
            className="translation-title-slot"
          />
          <SummaryPanel
            key={`${entry.id}:${aiPreferences.summaryTargetLanguage}:${aiPreferences.summaryDetailLevel}`}
            ref={summaryPanelRef}
            entryId={entry.id}
            isContentReady={isSummaryReady}
            isVisible={aiViewState.summaryVisible}
            targetLanguage={aiPreferences.summaryTargetLanguage}
            detailLevel={aiPreferences.summaryDetailLevel}
            onGeneratingChange={setIsSummaryGenerating}
            onVisibleChange={handleSummaryVisibleChange}
          />
          <TranslationPanel
            key={`${entry.id}:${aiPreferences.translationSourceLanguage}:${aiPreferences.translationTargetLanguage}:${aiPreferences.useTerminology}:${aiPreferences.useSmartContext}:${aiPreferences.translationExpertId}`}
            ref={translationPanelRef}
            entryId={entry.id}
            isContentReady={isTranslationReady}
            sourceLanguage={aiPreferences.translationSourceLanguage}
            targetLanguage={aiPreferences.translationTargetLanguage}
            useTerminology={aiPreferences.useTerminology}
            useSmartContext={aiPreferences.useSmartContext}
            expertId={aiPreferences.translationExpertId}
            shortcut={aiPreferences.fullTranslationShortcut}
            sourceHtml={content?.cleanedHtml ?? ''}
            titleTarget={titleTranslationTarget}
            isBilingualVisible={aiViewState.translationVisible}
            onContentClick={handleContentClick}
            onGeneratingChange={setIsTranslationGenerating}
            onBilingualChange={handleBilingualChange}
            onTitleTranslatingChange={setIsTitleTranslating}
            beforeTranslationStart={beforeTranslationStart}
            onTranslationControlStateChange={handleTranslationControlStateChange}
            onRetranslationStatusChange={handleRetranslationStatusChange}
          >
        <div className="entry-detail-body">
          {trustedVideoEmbed && (
            <div className="entry-detail-video-embed">
              <iframe
                src={trustedVideoEmbed.src}
                title={trustedVideoEmbed.title}
                loading="lazy"
                allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                sandbox="allow-scripts allow-same-origin allow-presentation"
                allowFullScreen
              />
            </div>
          )}
          {!trustedVideoEmbed && nativeVideoHtml && (
            <div
              className="entry-detail-video-embed entry-detail-html is-native"
              dangerouslySetInnerHTML={{ __html: nativeVideoHtml }}
            />
          )}
          {!hasArticleVideo && status === 'loading' && (
            <div className="entry-detail-loading">
              <p>Fetching and cleaning article content...</p>
            </div>
          )}

          {!hasArticleVideo && status === 'error' && (
            <div className="entry-detail-error">
              <p>⚠️ {error}</p>
              {entry.url && (
                <a
                  href={entry.url}
                  rel="noopener noreferrer"
                  onClick={(event) => handleExternalAnchorClick(event, entry.url ?? '')}
                >
                  Read original article instead ↗
                </a>
              )}
            </div>
          )}

          {!hasArticleVideo && status === 'success' && content && (
            <div className="entry-detail-content">
              {isPreview && (
                <div className="entry-detail-loading" role="status">
                  <p>正在显示订阅摘要，并在后台获取完整原文…</p>
                </div>
              )}
              {showRaw ? (
                <pre className="entry-detail-markdown">{content.markdown}</pre>
              ) : (
                <AnnotatedArticle
                  entryId={entry.id}
                  sourceHtml={content.cleanedHtml}
                  toolbarTarget={aiToolbarTarget}
                  onClick={handleContentClick}
                />
              )}
              <button
                type="button"
                className="btn-toggle-raw"
                onClick={() => setShowRaw(!showRaw)}
              >
                {showRaw ? 'Show rendered' : 'Show raw Markdown'}
              </button>
            </div>
          )}

          {!hasArticleVideo && status === 'success' && !content && (
            <div className="entry-detail-error">
              <p>No content available</p>
              {entry.url && (
                <a
                  href={entry.url}
                  rel="noopener noreferrer"
                  onClick={(event) => handleExternalAnchorClick(event, entry.url ?? '')}
                >
                  Read original article ↗
                </a>
              )}
            </div>
          )}

          {linkError && <p className="entry-detail-link-error" role="alert">{linkError}</p>}
        </div>
          </TranslationPanel>
        </div>
        {renderArticleHeader(true)}
        <InlineTranslationOverlay
          key={entry.id}
          containerRef={scrollContainerRef}
          paragraphShortcut={aiPreferences.paragraphTranslationShortcut}
          selectionShortcut={aiPreferences.selectionTranslationShortcut}
          sourceLanguage={aiPreferences.translationSourceLanguage}
          targetLanguage={aiPreferences.translationTargetLanguage}
          useTerminology={aiPreferences.useTerminology}
          expertId={aiPreferences.translationExpertId}
        />
        {onArticleChatSelection && (
          <ArticleChatSelectionMenu
            entryId={entry.id}
            containerRef={scrollContainerRef}
            onAskAI={onArticleChatSelection}
          />
        )}
        <ReadingProgressBook
          readingProgress={visibleReadingProgress}
          turnMotion={pageTurnAnimationEnabled ? readingBookTurn : null}
          jumpTarget={readingJumpTarget}
          onJump={handleReadingJump}
        />
      </div>

      <ExportOptionsDialog
        open={showExportDialog}
        articles={exportArticleAvail ? [exportArticleAvail] : []}
        onConfirm={handleExportConfirm}
        onCancel={handleExportCancel}
      />
    </>
  );
};

function RetranslationStatusNotice({ status }: { status: RetranslationStatus }) {
  const message = status.state === 'running'
    ? '正在重新翻译… 当前显示上一版译文'
    : status.state === 'paused'
      ? '重新翻译已暂停 · 当前仍显示上一版译文'
      : status.state === 'completed'
        ? '重新翻译已完成'
        : '重新翻译失败 · 已保留上一版译文';
  return (
    <div
      className={`translation-retranslation-status is-${status.state}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-translation-run-id={status.runId}
    >
      {status.state === 'running' && <span className="mini-spinner" aria-hidden="true" />}
      <span>{message}</span>
    </div>
  );
}
