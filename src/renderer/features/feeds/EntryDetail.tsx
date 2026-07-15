import { useState, useEffect, useRef } from 'react';
import type { CleanedContent } from '../../../shared/contracts/content.types';
import type { Entry } from '../../../shared/contracts/feed.types';
import shaleAppIcon from '../../../../assets/icons/shale-app-icon-1024.png';

interface EntryDetailProps {
  entry: Entry | null;
}

type LoadStatus = 'idle' | 'loading' | 'success' | 'error';

export const EntryDetail = ({ entry }: EntryDetailProps) => {
  const [content, setContent] = useState<CleanedContent | null>(null);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [error, setError] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const prevEntryId = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!entry) {
      setContent(null);
      setStatus('idle');
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
      } catch (err: any) {
        // Ignore abort errors
        if (err?.name === 'AbortError') return;
        setStatus('error');
        setError(err?.message ?? 'Failed to load content');
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

  if (!entry) {
    return (
      <div className="entry-detail empty">
        <div className="entry-detail-empty-content">
          <img className="entry-detail-empty-brand" src={shaleAppIcon} alt="" />
          <p>Select an article to read</p>
        </div>
      </div>
    );
  }

  return (
    <div className="entry-detail">
      <div className="entry-detail-header">
        <h2>{entry.title ?? 'Untitled'}</h2>
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
            <p>⚠️ {error}</p>
            {entry.url && (
              <a href={entry.url} target="_blank" rel="noopener noreferrer">
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
