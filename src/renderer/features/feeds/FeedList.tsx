import { useState, useEffect, useCallback } from 'react';
import type { Feed } from '../../../shared/contracts/feed.types';
import { FeedAddDialog } from './FeedAddDialog';

interface FeedListProps {
  feeds: Feed[];
  selectedFeedId: number | null;
  onSelectFeed: (feedId: number | null) => void;
  onRefresh: () => void;
  onUnreadCount: (feedId: number) => number;
  loading: boolean;
}

export const FeedList = ({
  feeds,
  selectedFeedId,
  onSelectFeed,
  onRefresh,
  onUnreadCount,
  loading,
}: FeedListProps) => {
  const [showAddDialog, setShowAddDialog] = useState(false);

  const handleAdd = useCallback(
    async (url: string) => {
      const result = await window.shaleAPI.feed.add(url);
      if (!result.ok) {
        throw new Error(result.error?.message ?? 'Unknown error');
      }
      onRefresh();
    },
    [onRefresh],
  );

  return (
    <div className="feed-list">
      <div className="feed-list-header">
        <h3>Feeds</h3>
        <div className="feed-list-actions">
          <button
            type="button"
            className="btn-icon"
            onClick={onRefresh}
            disabled={loading}
            title="Sync all feeds"
          >
            🔄
          </button>
          <button
            type="button"
            className="btn-icon"
            onClick={() => setShowAddDialog(true)}
            title="Add feed"
          >
            ➕
          </button>
        </div>
      </div>

      <div className="feed-items">
        <button
          type="button"
          className={`feed-item ${selectedFeedId === null ? 'active' : ''}`}
          onClick={() => onSelectFeed(null)}
        >
          <span className="feed-item-name">All Feeds</span>
          <span className="feed-item-count">
            {feeds.reduce((sum, f) => sum + onUnreadCount(f.id), 0)}
          </span>
        </button>

        {feeds.map((feed) => (
          <button
            key={feed.id}
            type="button"
            className={`feed-item ${selectedFeedId === feed.id ? 'active' : ''}`}
            onClick={() => onSelectFeed(feed.id)}
          >
            <span className="feed-item-name">{feed.title ?? feed.feedURL}</span>
            {feed.lastSyncStatus === 'error' && (
              <span className="feed-item-error" title={feed.lastSyncError}>
                ⚠️
              </span>
            )}
            <span className="feed-item-count">{onUnreadCount(feed.id)}</span>
          </button>
        ))}
      </div>

      {feeds.length === 0 && !loading && (
        <p className="feed-list-empty">No feeds yet. Click + to add one.</p>
      )}

      {loading && <p className="feed-list-loading">Loading feeds...</p>}

      {showAddDialog && (
        <FeedAddDialog
          onAdd={handleAdd}
          onClose={() => setShowAddDialog(false)}
        />
      )}
    </div>
  );
};