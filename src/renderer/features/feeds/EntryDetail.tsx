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
} from '../translation/TranslationPanel';
import type { AiPreferences } from '../settings/aiPreferences';
import { InlineTranslationOverlay } from '../translation/InlineTranslationOverlay';
import { SummaryIcon, TranslateIcon } from '../reader/ReaderIcons';
import { formatArticleDate, getArticleDateLocale } from './articleMetadata';
import type { EntryAIViewState } from './entryAIViewState';
import {
  calculateReadingProgress,
  getScrollTopForReadingProgress,
} from './readingProgress';
import {
  getNativeVideoHtml,
  getTrustedVideoEmbed,
} from './trustedVideoEmbed';
import { AnnotatedArticle } from '../annotations/AnnotatedArticle';

interface EntryDetailProps {
  entry: Entry | null;
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
  onAIViewStateChange: (
    entryId: number,
    change: Partial<EntryAIViewState>,
  ) => void;
  onReadingProgressChange: (entryId: number, readingProgress: number) => Promise<void>;
}

type LoadStatus = 'idle' | 'loading' | 'success' | 'error';

const WINDOW_TOP_REVEAL_ZONE = 60;

export const EntryDetail = ({
  entry,
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
  onAIViewStateChange,
  onReadingProgressChange,
}: EntryDetailProps) => {
  const [content, setContent] = useState<CleanedContent | null>(null);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [error, setError] = useState('');
  const [linkError, setLinkError] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [isSummaryGenerating, setIsSummaryGenerating] = useState(false);
  const [isTranslationGenerating, setIsTranslationGenerating] = useState(false);
  const [isTitleTranslating, setIsTitleTranslating] = useState(false);
  const [titleTranslationTarget, setTitleTranslationTarget] = useState<HTMLDivElement | null>(null);
  const [isFloatingHeaderVisible, setIsFloatingHeaderVisible] = useState(false);
  const prevEntryId = useRef<number | null>(null);
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
  const handleSummaryVisibleChange = useCallback((summaryVisible: boolean): void => {
    if (!entry) return;
    onAIViewStateChange(entry.id, { summaryVisible });
  }, [entry?.id, onAIViewStateChange]);
  const handleBilingualChange = useCallback((translationVisible: boolean): void => {
    if (!entry) return;
    onAIViewStateChange(entry.id, { translationVisible });
  }, [entry?.id, onAIViewStateChange]);

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

    // Abort any in-flight request for previous entry (P2-#10: race condition fix)
    if (abortRef.current) {
      abortRef.current.abort();
    }

    // Avoid re-fetching same entry
    if (prevEntryId.current === entry.id) return;
    prevEntryId.current = entry.id;

    const loadContent = async () => {
      setContent(null);
      setStatus('loading');
      setError('');
      setLinkError('');
      abortRef.current = new AbortController();

      try {
        // First check if content already exists
        const existingResult = await window.shaleAPI.content.get(entry.id);
        if (!existingResult.ok) {
          // IPC-level error (not "no content")
          setStatus('error');
          setError(existingResult.error?.message ?? 'Failed to check existing content');
          return;
        }

        if (existingResult.data !== null) {
          // Already has cleaned content
          setContent(existingResult.data);
          setStatus('success');
          return;
        }

        // No existing content (null) — fetch and clean
        const fetchResult = await window.shaleAPI.content.fetchAndClean(entry.id);
        if (!fetchResult.ok) {
          setStatus('error');
          setError(fetchResult.error?.message ?? 'Failed to fetch content');
          return;
        }
        setContent(fetchResult.data);
        setStatus('success');
      } catch (err: unknown) {
        // Ignore abort errors
        if (err instanceof Error && err.name === 'AbortError') return;
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Failed to load content');
      }
    };

    loadContent();

    return () => {
      // Cleanup: abort in-flight request on unmount
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [entry?.id]);

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
    setIsTitleTranslating(false);
  }, [entry?.id]);

  useEffect(() => () => {
    flushReadingProgress();
  }, [entry?.id, flushReadingProgress]);

  useEffect(() => {
    if (
      !entry
      || readerDisplayState !== 'article'
      || status !== 'success'
      || !content
      || restoredEntryIdRef.current === entry.id
    ) {
      return;
    }

    const entryId = entry.id;
    const savedReadingProgress = entry.readingProgress;
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
    const action = getFloatingReaderHeaderAction({
      currentScrollTop,
      previousScrollTop: previousScrollTopRef.current,
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
    if (status !== 'success' || !content) return;
    hasUserScrolledSinceRestoreRef.current = true;
    isRestoringProgressRef.current = false;
    programmaticScrollRef.current = null;
  };

  const isSummaryReady = status === 'success'
    && !hasArticleVideo
    && Boolean(content?.markdown.trim());
  const isTranslationReady = status === 'success'
    && !hasArticleVideo
    && Boolean(content?.cleanedHtml.trim());
  const articleDateLocale = getArticleDateLocale(
    entry.title,
    content?.markdown ?? entry.summary,
  );

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

  const aiToolbar = aiToolbarTarget
    ? createPortal(
      <div className="entry-detail-ai-actions" aria-label="AI reading aids">
        <button
          type="button"
          className={aiViewState.summaryVisible ? 'is-active' : ''}
          aria-label={isSummaryGenerating ? '正在生成摘要' : '生成或显示摘要'}
          aria-controls="summary-result"
          aria-expanded={aiViewState.summaryVisible}
          aria-busy={isSummaryGenerating}
          disabled={!isSummaryReady || isSummaryGenerating}
          title={isSummaryGenerating
            ? 'Summarizing...'
            : isSummaryReady
              ? 'Generate or show Summary'
            : 'Summary is available after the article loads'}
          onClick={() => activateSummary(true)}
        >
          <SummaryIcon />
        </button>
        <button
          type="button"
          className={aiViewState.translationVisible ? 'is-active' : ''}
          aria-label={isTranslationGenerating ? '正在翻译' : '翻译或切换双语视图'}
          aria-pressed={aiViewState.translationVisible}
          disabled={!isTranslationReady || isTranslationGenerating}
          title={isTranslationGenerating
            ? 'Translating...'
            : isTranslationReady
              ? 'Translate or toggle the bilingual view'
            : 'Translation is available after the article loads'}
          onClick={activateTranslation}
          aria-busy={isTranslationGenerating}
        >
          <TranslateIcon />
        </button>
      </div>,
      aiToolbarTarget,
    )
    : null;

  return (
    <>
      {aiToolbar}
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
            key={`${entry.id}:${aiPreferences.translationTargetLanguage}:${aiPreferences.useTerminology}`}
            ref={translationPanelRef}
            entryId={entry.id}
            isContentReady={isTranslationReady}
            targetLanguage={aiPreferences.translationTargetLanguage}
            useTerminology={aiPreferences.useTerminology}
            shortcut={aiPreferences.fullTranslationShortcut}
            sourceHtml={content?.cleanedHtml ?? ''}
            titleTarget={titleTranslationTarget}
            isBilingualVisible={aiViewState.translationVisible}
            onGeneratingChange={setIsTranslationGenerating}
            onBilingualChange={handleBilingualChange}
            onTitleTranslatingChange={setIsTitleTranslating}
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
          targetLanguage={aiPreferences.translationTargetLanguage}
          useTerminology={aiPreferences.useTerminology}
        />
      </div>
    </>
  );
};
