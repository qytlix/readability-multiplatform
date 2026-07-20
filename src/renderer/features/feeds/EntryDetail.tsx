import {
  useState,
  useEffect,
  useRef,
  type MouseEvent,
  type UIEvent,
} from 'react';
import type { CleanedContent } from '../../../shared/contracts/content.types';
import type { Entry } from '../../../shared/contracts/feed.types';
import settlingPointAnimated from '../../assets/illustrations/empty-state/settling-point-animated.svg';
import settlingPointStatic from '../../assets/illustrations/empty-state/settling-point-static.svg';
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

interface EntryDetailProps {
  entry: Entry | null;
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
}

type LoadStatus = 'idle' | 'loading' | 'success' | 'error';

const WINDOW_TOP_REVEAL_ZONE = 60;

export const EntryDetail = ({
  entry,
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
}: EntryDetailProps) => {
  const [content, setContent] = useState<CleanedContent | null>(null);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [error, setError] = useState('');
  const [linkError, setLinkError] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [isSummaryGenerating, setIsSummaryGenerating] = useState(false);
  const [isSummaryVisible, setIsSummaryVisible] = useState(false);
  const [isTranslationGenerating, setIsTranslationGenerating] = useState(false);
  const [isTitleTranslating, setIsTitleTranslating] = useState(false);
  const [isBilingualVisible, setIsBilingualVisible] = useState(false);
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

  useEffect(() => {
    if (!entry) {
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
    currentScrollTopRef.current = 0;
    previousScrollTopRef.current = 0;
    isFloatingHeaderHoveredRef.current = false;
    setIsFloatingHeaderVisible(false);
    setIsSummaryGenerating(false);
    setIsSummaryVisible(false);
    setIsTranslationGenerating(false);
    setIsTitleTranslating(false);
    setIsBilingualVisible(false);
  }, [entry?.id]);

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

  const readerDisplayState = getReaderDisplayState({
    feedLoadStatus,
    feedCount,
    entryLoadStatus,
    entryCount,
    hasSelectedEntry: entry !== null,
  });

  if (readerDisplayState === 'feed-loading') {
    return <div className="entry-detail empty entry-detail-empty-state">Loading feeds…</div>;
  }

  if (readerDisplayState === 'feed-error') {
    return (
      <div className="entry-detail empty entry-detail-empty-state">
        <div className="entry-detail-empty-message">
          <h2>Unable to load feeds</h2>
          <p>{feedLoadError}</p>
          <button type="button" className="reader-empty-action" onClick={onRetryFeeds}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (readerDisplayState === 'no-feeds') {
    return (
      <div className="entry-detail empty entry-detail-empty-state">
        <div className="entry-detail-empty-message">
          <h2>Add your first feed</h2>
          <p>Subscribe to an RSS or Atom feed to start reading.</p>
          <button type="button" className="reader-empty-action" onClick={onAddFeed}>
            <span aria-hidden="true">＋</span>
            Add Feed
          </button>
        </div>
      </div>
    );
  }

  if (readerDisplayState === 'entries-loading') {
    return <div className="entry-detail empty entry-detail-empty-state">Loading articles…</div>;
  }

  if (readerDisplayState === 'entries-error') {
    return (
      <div className="entry-detail empty entry-detail-empty-state">
        <div className="entry-detail-empty-message">
          <h2>Unable to load articles</h2>
          <p>{entryLoadError}</p>
          <button type="button" className="reader-empty-action" onClick={onRetryEntries}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (readerDisplayState === 'no-articles') {
    return (
      <div className="entry-detail empty entry-detail-empty-state">
        <div className="entry-detail-empty-message">
          <h2>No articles yet</h2>
          <p>Sync a feed to look for new articles.</p>
        </div>
      </div>
    );
  }

  if (readerDisplayState === 'no-selection') {
    return (
      <div className="entry-detail empty entry-detail-empty-selection">
        <div className="entry-detail-empty-content">
          <picture className="entry-detail-empty-illustration" aria-hidden="true">
            <source media="(prefers-reduced-motion: reduce)" srcSet={settlingPointStatic} />
            <img src={settlingPointAnimated} alt="" />
          </picture>
          <p className="entry-detail-empty-primary">Select an article to read</p>
          <p className="entry-detail-empty-secondary">Let ideas settle into layers.</p>
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
  };

  const isSummaryReady = status === 'success' && Boolean(content?.markdown.trim());
  const isTranslationReady = status === 'success' && Boolean(content?.cleanedHtml.trim());

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
        <h2>
          {entry.title ?? 'Untitled'}
          {isTitleTranslating && (
            <span
              className="translation-segment-spinner"
              role="img"
              aria-label="Translating the article title"
            />
          )}
        </h2>
        <div className="entry-detail-ai-actions" aria-label="AI reading aids">
          <button
            type="button"
            className={isSummaryVisible ? 'is-active' : ''}
            aria-controls="summary-result"
            aria-expanded={isSummaryVisible}
            disabled={!isSummaryReady || isSummaryGenerating}
            tabIndex={floating ? -1 : undefined}
            title={isSummaryReady ? 'Generate or show Summary' : 'Summary is available after the article loads'}
            onClick={() => activateSummary(floating)}
          >
            {isSummaryGenerating ? 'Summarizing...' : 'Summary'}
          </button>
          <button
            type="button"
            className={isBilingualVisible ? 'is-active' : ''}
            aria-pressed={isBilingualVisible}
            disabled={!isTranslationReady || isTranslationGenerating}
            tabIndex={floating ? -1 : undefined}
            title={isTranslationReady ? 'Translate or toggle the bilingual view' : 'Translation is available after the article loads'}
            onClick={activateTranslation}
            aria-busy={isTranslationGenerating}
          >
            Translate
          </button>
        </div>
      </div>
      <div className="entry-detail-meta">
        {entry.author && <span className="entry-detail-author">{entry.author}</span>}
        {entry.publishedAt && (
          <span className="entry-detail-date">
            {new Date(entry.publishedAt).toLocaleDateString(undefined, {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </span>
        )}
      </div>
      {entry.url && (
        <a
          href={entry.url}
          rel="noopener noreferrer"
          className="entry-detail-original"
          tabIndex={floating ? -1 : undefined}
          onClick={(event) => handleExternalAnchorClick(event, entry.url ?? '')}
        >
          View original ↗
        </a>
      )}
    </div>
  );

  return (
    <div className="entry-detail">
      <div ref={scrollContainerRef} className="entry-detail-scroll" onScroll={handleReaderScroll}>
        {renderArticleHeader()}
        <SummaryPanel
          ref={summaryPanelRef}
          entryId={entry.id}
          isContentReady={isSummaryReady}
          targetLanguage={aiPreferences.summaryTargetLanguage}
          detailLevel={aiPreferences.summaryDetailLevel}
          onGeneratingChange={setIsSummaryGenerating}
          onVisibleChange={setIsSummaryVisible}
        />
        <TranslationPanel
          ref={translationPanelRef}
          entryId={entry.id}
          isContentReady={isTranslationReady}
          targetLanguage={aiPreferences.translationTargetLanguage}
          sourceHtml={content?.cleanedHtml ?? ''}
          onGeneratingChange={setIsTranslationGenerating}
          onBilingualChange={setIsBilingualVisible}
          onTitleTranslatingChange={setIsTitleTranslating}
        >
        <div className="entry-detail-body">
          {status === 'loading' && (
            <div className="entry-detail-loading">
              <p>Fetching and cleaning article content...</p>
            </div>
          )}

          {status === 'error' && (
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

          {status === 'success' && content && (
            <div className="entry-detail-content">
              {showRaw ? (
                <pre className="entry-detail-markdown">{content.markdown}</pre>
              ) : (
                <div
                  className="entry-detail-html"
                  dangerouslySetInnerHTML={{ __html: content.cleanedHtml }}
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

          {status === 'success' && !content && (
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
        containerRef={scrollContainerRef}
        shortcut={aiPreferences.inlineTranslationShortcut}
        targetLanguage={aiPreferences.translationTargetLanguage}
      />
    </div>
  );
};
