import { useState, useEffect, useRef, useCallback } from 'react';
import type { CleanedContent } from '../../../shared/contracts/content.types';
import type { Entry } from '../../../shared/contracts/feed.types';

interface EntryDetailProps {
  entry: Entry | null;
}

type LoadStatus = 'idle' | 'loading' | 'success' | 'error';
type ViewMode = 'cleaned' | 'markdown' | 'source';

export const EntryDetail = ({ entry }: EntryDetailProps) => {
  const [content, setContent] = useState<CleanedContent | null>(null);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('cleaned');
  const prevEntryId = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadContent = useCallback(async (entryId: number) => {
    if (abortRef.current) {
      abortRef.current.abort();
    }

    setStatus('loading');
    setError('');

    try {
      // First check if content already exists
      const existingResult = await window.shaleAPI.content.get(entryId);
      if (!isMountedRef.current) return;

      if (!existingResult.ok) {
        setStatus('error');
        setError(existingResult.error?.message ?? 'Failed to check existing content');
        return;
      }

      if (existingResult.data !== null) {
        // Check if it's a failed pipeline
        if (existingResult.data.pipelineStatus === 'failed') {
          setContent(existingResult.data);
          setError(existingResult.data.pipelineError ?? 'Content extraction failed');
          setStatus('error');
          return;
        }

        // Already has cleaned content
        setContent(existingResult.data);
        setStatus('success');
        return;
      }

      // No existing content — fetch and clean
      const fetchResult = await window.shaleAPI.content.fetchAndClean(entryId);
      if (!isMountedRef.current) return;

      if (!fetchResult.ok) {
        setStatus('error');
        setError(fetchResult.error?.message ?? 'Failed to fetch content');
        return;
      }

      if (fetchResult.data.pipelineStatus === 'failed') {
        setContent(fetchResult.data);
        setError(fetchResult.data.pipelineError ?? 'Content extraction failed');
        setStatus('error');
        return;
      }

      setContent(fetchResult.data);
      setStatus('success');
    } catch (err: any) {
      if (!isMountedRef.current) return;
      if (err?.name === 'AbortError') return;
      setStatus('error');
      setError(err?.message ?? 'Failed to load content');
    }
  }, []);

  useEffect(() => {
    if (!entry) {
      setContent(null);
      setStatus('idle');
      setError('');
      return;
    }

    // Avoid re-fetching same entry
    if (prevEntryId.current === entry.id) return;
    prevEntryId.current = entry.id;

    loadContent(entry.id);
  }, [entry?.id, loadContent]);

  const handleRetry = useCallback(() => {
    if (!entry) return;
    prevEntryId.current = null; // Reset to force re-fetch
    loadContent(entry.id);
  }, [entry, loadContent]);

  const handleMarkStarred = useCallback(async () => {
    if (!entry) return;
    await window.shaleAPI.entry.markStarred(entry.id, !entry.isStarred);
  }, [entry]);

  const handleOpenInBrowser = useCallback(() => {
    if (!entry?.url) return;
    window.shaleAPI.system.openExternal(entry.url);
  }, [entry]);

  if (!entry) {
    return (
      <div className="entry-detail empty">
        <p>Select an article to read</p>
      </div>
    );
  }

  const pipelineError = content?.pipelineError;
  const isNetworkError = pipelineError?.toLowerCase().includes('network')
    || pipelineError?.toLowerCase().includes('timeout')
    || pipelineError?.toLowerCase().includes('fetch');
  const isCleanFailed = pipelineError?.toLowerCase().includes('clean')
    || pipelineError?.toLowerCase().includes('readability')
    || (status === 'error' && !isNetworkError);

  return (
    <div className="entry-detail">
      <div className="entry-detail-header">
        <div className="entry-detail-header-top">
          <h2>{entry.title ?? 'Untitled'}</h2>
          {entry.url && (
            <button
              type="button"
              className="btn-open-browser"
              onClick={handleOpenInBrowser}
              title="Open in default browser"
            >
              ↗
            </button>
          )}
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
          <button
            type="button"
            className={`btn-star ${entry.isStarred ? 'starred' : ''}`}
            onClick={handleMarkStarred}
            title={entry.isStarred ? 'Unstar' : 'Star'}
          >
            {entry.isStarred ? '★' : '☆'}
          </button>
        </div>
        {entry.url && (
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="entry-detail-original"
          >
            View original ↗
          </a>
        )}
      </div>

      <div className="entry-detail-body">
        {status === 'loading' && (
          <div className="entry-detail-loading">
            <p>Fetching and cleaning article content...</p>
          </div>
        )}

        {status === 'error' && (
          <div className="entry-detail-error">
            <p>⚠️&nbsp;{pipelineError || error}</p>

            {isNetworkError && (
              <p className="entry-detail-error-hint">Network unavailable. Please check your connection and try again.</p>
            )}

            {isCleanFailed && entry.url && (
              <div className="entry-detail-error-actions">
                <p>Could not extract article content.</p>
                <a href={entry.url} target="_blank" rel="noopener noreferrer">
                  Read original article ↗
                </a>
              </div>
            )}

            {!entry.url && (
              <p>No URL available for this entry.</p>
            )}

            <button type="button" className="btn-retry" onClick={handleRetry}>
              Retry
            </button>
          </div>
        )}

        {status === 'success' && content && (
          <div className="entry-detail-content">
            <div className="entry-detail-view-controls">
              <button
                type="button"
                className={`btn-view-mode${viewMode === 'cleaned' ? ' active' : ''}`}
                onClick={() => setViewMode('cleaned')}
              >
                Cleaned
              </button>
              <button
                type="button"
                className={`btn-view-mode${viewMode === 'markdown' ? ' active' : ''}`}
                onClick={() => setViewMode('markdown')}
              >
                Markdown
              </button>
              <button
                type="button"
                className={`btn-view-mode${viewMode === 'source' ? ' active' : ''}`}
                onClick={() => setViewMode('source')}
                disabled={!content.html}
                title={content.html ? 'View original HTML' : 'Original HTML not available'}
              >
                Source HTML
              </button>
            </div>
            {viewMode === 'source' && content.html ? (
              <div
                className="entry-detail-html"
                dangerouslySetInnerHTML={{ __html: content.html }}
              />
            ) : viewMode === 'markdown' ? (
              <pre className="entry-detail-markdown">{content.markdown}</pre>
            ) : (
              <div
                className="entry-detail-html"
                dangerouslySetInnerHTML={{ __html: content.cleanedHtml }}
              />
            )}
          </div>
        )}

        {status === 'success' && !content && (
          <div className="entry-detail-error">
            <p>No content available</p>
            {entry.url && (
              <a href={entry.url} target="_blank" rel="noopener noreferrer">
                Read original article ↗
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
};