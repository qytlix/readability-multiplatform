import { useState, useEffect, useCallback, useRef } from 'react';
import type { EntryListItem } from '../../../shared/contracts/feed.types';

interface EntryListProps {
  entries: EntryListItem[];
  selectedEntryId: number | null;
  feedId: number | null;
  loading: boolean;
  onSelectEntry: (entryId: number) => void;
  onLoadMore: () => void;
  hasMore: boolean;
}

export const EntryList = ({
  entries,
  selectedEntryId,
  feedId,
  loading,
  onSelectEntry,
  onLoadMore,
  hasMore,
}: EntryListProps) => {
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    if (!hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMore();
        }
      },
      { threshold: 0.1 },
    );

    const el = loadMoreRef.current;
    if (el) observer.observe(el);

    return () => {
      if (el) observer.unobserve(el);
    };
  }, [hasMore, loading, onLoadMore]);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="entry-list">
      <div className="entry-list-header">
        <h3>{feedId ? 'Entries' : 'All Entries'}</h3>
        <span className="entry-count">{entries.length}</span>
      </div>

      <div className="entry-items">
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`entry-item ${selectedEntryId === entry.id ? 'active' : ''} ${entry.isRead ? 'read' : 'unread'}`}
            onClick={() => {
              onSelectEntry(entry.id);
              // Mark as read
              if (!entry.isRead) {
                window.shaleAPI.entry.markRead([entry.id], true);
              }
            }}
          >
            <div className="entry-item-header">
              <span className="entry-item-title">
                {entry.isRead ? '' : '● '}
                {entry.title ?? 'Untitled'}
              </span>
              {entry.feedTitle && (
                <span className="entry-item-feed">{entry.feedTitle}</span>
              )}
            </div>
            <div className="entry-item-meta">
              <span className="entry-item-date">{formatDate(entry.publishedAt ?? entry.createdAt)}</span>
              {entry.author && <span className="entry-item-author">{entry.author}</span>}
            </div>
            {entry.summary && (
              <p className="entry-item-summary">{entry.summary.slice(0, 150)}</p>
            )}
          </button>
        ))}
      </div>

      {hasMore && (
        <div ref={loadMoreRef} className="entry-list-load-more">
          {loading ? 'Loading...' : 'Scroll for more'}
        </div>
      )}

      {entries.length === 0 && !loading && (
        <p className="entry-list-empty">No entries to show.</p>
      )}
    </div>
  );
};