import { useState, useCallback } from 'react';
import type { Feed } from '../../../shared/contracts/feed.types';
import { FeedAddDialog } from './FeedAddDialog';

interface UnreadCountProps {
  count: number;
}

const UnreadCount = ({ count }: UnreadCountProps) => {
  if (count <= 0) return null;

  const unreadLabel = `${count} unread article${count === 1 ? '' : 's'}`;

  return (
    <span className="feed-item-count" title={unreadLabel} aria-label={unreadLabel}>
      <span aria-hidden="true">{count}</span>
    </span>
  );
};

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
  const totalUnreadCount = feeds.reduce(
    (sum, feed) => sum + onUnreadCount(feed.id),
    0,
  );

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
      <section className="feed-section" aria-labelledby="library-heading">
        <div className="feed-list-header">
          <h3 id="library-heading">Library</h3>
        </div>

        <div className="feed-items">
          <button
            type="button"
            className={`feed-item ${selectedFeedId === null ? 'active' : ''}`}
            onClick={() => onSelectFeed(null)}
          >
            <span className="feed-item-name" title="All Articles">
              All Articles
            </span>
            <UnreadCount count={totalUnreadCount} />
          </button>
        </div>
      </section>

      <section className="feed-section" aria-labelledby="feeds-heading">
        <div className="feed-list-header">
          <h3 id="feeds-heading">Feeds</h3>
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
          </div>
        </div>

        <button
          type="button"
          className="add-feed-button"
          onClick={() => setShowAddDialog(true)}
        >
          <span className="add-feed-button-icon" aria-hidden="true">＋</span>
          Add Feed
        </button>

        <div className="feed-items">
          {feeds.map((feed) => {
            const feedName = feed.title ?? feed.feedURL;

            return (
              <button
                key={feed.id}
                type="button"
                className={`feed-item ${selectedFeedId === feed.id ? 'active' : ''}`}
                onClick={() => onSelectFeed(feed.id)}
              >
                <span className="feed-item-name" title={feedName}>{feedName}</span>
                {feed.lastSyncStatus === 'error' && (
                  <span className="feed-item-error" title={feed.lastSyncError}>
                    ⚠️
                  </span>
                )}
                <UnreadCount count={onUnreadCount(feed.id)} />
              </button>
            );
          })}
        </div>
      </section>

      {feeds.length === 0 && !loading && (
        <p className="feed-list-empty">No feeds yet. Add one to get started.</p>
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
