import { useState, useEffect, useCallback, useRef } from 'react';
import type { Feed } from '../../../shared/contracts/feed.types';
import { FeedEditDialog } from './FeedEditDialog';
import { OPMLDialog } from './OPMLDialog';
import type { FeedLoadStatus } from './readerState';

type SyncStatus = 'idle' | 'loading' | 'success' | 'error';

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

const SyncCycleIcon = () => (
  <svg className="sync-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M20 8a7 7 0 0 0-12-3L6 7M6 3v4h4" />
    <path d="M4 16a7 7 0 0 0 12 3l2-2M18 21v-4h-4" />
  </svg>
);

const SyncSuccessIcon = () => (
  <svg className="sync-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);

const SyncErrorIcon = () => (
  <svg className="sync-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 4 21 20H3L12 4Z" />
    <path d="M12 9v5" />
    <path d="M12 17h.01" />
  </svg>
);

const SettingsIcon = () => (
  <svg className="feed-settings-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
    <path d="M19 13.4v-2.8l-2-.7a7.5 7.5 0 0 0-.7-1.7l.9-1.9-2-2-1.9.9a7.5 7.5 0 0 0-1.7-.7l-.7-2H8.1l-.7 2a7.5 7.5 0 0 0-1.7.7l-1.9-.9-2 2 .9 1.9a7.5 7.5 0 0 0-.7 1.7l-2 .7v2.8l2 .7a7.5 7.5 0 0 0 .7 1.7l-.9 1.9 2 2 1.9-.9a7.5 7.5 0 0 0 1.7.7l.7 2h2.8l.7-2a7.5 7.5 0 0 0 1.7-.7l1.9.9 2-2-.9-1.9a7.5 7.5 0 0 0 .7-1.7l2-.7Z" />
  </svg>
);

const syncStatusLabels: Record<SyncStatus, string> = {
  idle: 'Sync all feeds',
  loading: 'Syncing…',
  success: 'Synced just now',
  error: 'Sync failed. Click to retry.',
};

interface FeedListProps {
  feeds: Feed[];
  selectedFeedId: number | null;
  onSelectFeed: (feedId: number | null) => void;
  onRefresh: () => Promise<boolean>;
  onLocalRefresh: () => Promise<void>;
  onOpenAddFeed: () => void;
  onUnreadCount: (feedId: number) => number;
  loading: boolean;
  feedLoadStatus: FeedLoadStatus;
  settingsActive: boolean;
  onOpenSettings: () => void;
}

export const FeedList = ({
  feeds,
  selectedFeedId,
  onSelectFeed,
  onRefresh,
  onLocalRefresh,
  onOpenAddFeed,
  onUnreadCount,
  loading,
  feedLoadStatus,
  settingsActive,
  onOpenSettings,
}: FeedListProps) => {
  const [editFeed, setEditFeed] = useState<Feed | null>(null);
  const [showOPMLDialog, setShowOPMLDialog] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncProgress, setSyncProgress] = useState<Record<number, string>>({});
  const isMountedRef = useRef(true);
  const syncInFlightRef = useRef(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanProgressRef = useRef<(() => void) | null>(null);
  const totalUnreadCount = feeds.reduce(
    (sum, feed) => sum + onUnreadCount(feed.id),
    0,
  );

  const clearSuccessTimer = useCallback(() => {
    if (successTimerRef.current !== null) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    // Listen for sync progress events
    cleanProgressRef.current = window.shaleAPI.feed.onSyncProgress((progress) => {
      if (!isMountedRef.current) return;
      setSyncProgress((prev) => ({
        ...prev,
        [progress.feedId]: progress.status,
      }));

      // Clear progress after done/error
      if (progress.status === 'done' || progress.status === 'error') {
        setTimeout(() => {
          if (isMountedRef.current) {
            setSyncProgress((prev) => {
              const next = { ...prev };
              delete next[progress.feedId];
              return next;
            });
          }
        }, 3000);
      }
    });

    return () => {
      isMountedRef.current = false;
      clearSuccessTimer();
      if (cleanProgressRef.current) {
        cleanProgressRef.current();
        cleanProgressRef.current = null;
      }
    };
  }, [clearSuccessTimer]);

  const handleEdit = useCallback(
    async (params: { title?: string; siteURL?: string; syncIntervalMin?: number }) => {
      if (!editFeed) return;
      const result = await window.shaleAPI.feed.update(editFeed.id, params);
      if (!result.ok) {
        throw new Error(result.error?.message ?? 'Failed to update feed');
      }
      await onLocalRefresh();
    },
    [editFeed, onLocalRefresh],
  );

  const handleRemove = useCallback(
    async (feedId: number) => {
      if (!window.confirm('Remove this feed? All articles from this feed will be deleted.')) return;
      const result = await window.shaleAPI.feed.remove(feedId);
      if (!result.ok) {
        console.error('Failed to remove feed:', result.error);
        return;
      }
      if (selectedFeedId === feedId) {
        onSelectFeed(null);
      }
      await onLocalRefresh();
    },
    [onLocalRefresh, onSelectFeed, selectedFeedId],
  );

  const handleSingleSync = useCallback(async (feedId: number) => {
    await window.shaleAPI.feed.sync(feedId);
    await onLocalRefresh();
  }, [onLocalRefresh]);

  const handleSync = useCallback(async () => {
    if (syncInFlightRef.current) return;

    syncInFlightRef.current = true;
    clearSuccessTimer();
    setSyncStatus('loading');

    let succeeded = false;
    try {
      succeeded = await onRefresh();
    } catch {
      succeeded = false;
    } finally {
      syncInFlightRef.current = false;
    }

    if (!isMountedRef.current) return;

    if (!succeeded) {
      setSyncStatus('error');
      return;
    }

    setSyncStatus('success');
    successTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setSyncStatus('idle');
      }
      successTimerRef.current = null;
    }, 1000);
  }, [clearSuccessTimer, onRefresh]);

  const handleOPMLImport = useCallback(
    async (filePath: string, mode: 'merge' | 'replace') => {
      const result = await window.shaleAPI.opml.import(filePath, mode);
      if (!result.ok) {
        throw new Error(result.error?.message ?? 'OPML import failed');
      }
      await onRefresh();
      return result.data;
    },
    [onRefresh],
  );

  const handleOPMLExport = useCallback(async (filePath: string) => {
    const result = await window.shaleAPI.opml.export(filePath);
    if (!result.ok) {
      throw new Error(result.error?.message ?? 'OPML export failed');
    }
  }, []);

  const isSyncing = syncStatus === 'loading';
  const syncLabel = syncStatusLabels[syncStatus];

  return (
    <div className="feed-list">
      <section className="feed-section" aria-labelledby="library-heading">
        <div className="feed-list-header">
          <h3 id="library-heading">Library</h3>
        </div>

        <div className="feed-items">
          <button
            type="button"
            className={`feed-item ${selectedFeedId === null && !settingsActive ? 'active' : ''}`}
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
              className={`sync-button ${syncStatus}`}
              onClick={() => {
                void handleSync();
              }}
              aria-busy={isSyncing}
              aria-disabled={isSyncing}
              aria-label={syncLabel}
              title={syncLabel}
            >
              {syncStatus === 'success' && <SyncSuccessIcon />}
              {syncStatus === 'error' && <SyncErrorIcon />}
              {(syncStatus === 'idle' || syncStatus === 'loading') && <SyncCycleIcon />}
            </button>
          </div>
        </div>

        {syncStatus === 'error' && (
          <p className="sync-error-message" role="status">
            Sync failed. Click to retry.
          </p>
        )}

        <button
          type="button"
          className="add-feed-button"
          onClick={onOpenAddFeed}
        >
          <span className="add-feed-button-icon" aria-hidden="true">＋</span>
          Add Feed
        </button>

        <button
          type="button"
          className="add-feed-button"
          onClick={() => setShowOPMLDialog(true)}
          style={{ borderColor: 'var(--slate-border)', background: 'transparent', fontSize: '12px' }}
        >
          <span className="add-feed-button-icon" aria-hidden="true" style={{ fontSize: '14px' }}>≡</span>
          OPML
        </button>

        <div className="feed-items">
          {feeds.map((feed) => {
            const feedName = feed.title ?? feed.feedURL;
            const feedSyncStatus = syncProgress[feed.id];

            return (
              <div key={feed.id} className="feed-item-wrapper">
                <button
                  type="button"
                  className={`feed-item ${selectedFeedId === feed.id && !settingsActive ? 'active' : ''}`}
                  onClick={() => onSelectFeed(feed.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setEditFeed(feed);
                  }}
                >
                  <span className="feed-item-name" title={feedName}>
                    {feedSyncStatus === 'fetching' && '⟳ '}
                    {feedSyncStatus === 'parsing' && '⟳ '}
                    {feedSyncStatus === 'done' && '✓ '}
                    {feedSyncStatus === 'error' && '✗ '}
                    {feedName}
                  </span>
                  {feed.lastSyncStatus === 'error' && !syncProgress[feed.id] && (
                    <span className="feed-item-error" title={feed.lastSyncError}>
                      ⚠️
                    </span>
                  )}
                  <div className="feed-item-actions">
                    <button
                      type="button"
                      className="feed-item-action"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSingleSync(feed.id);
                      }}
                      title="Refresh this feed"
                    >
                      ↻
                    </button>
                    <button
                      type="button"
                      className="feed-item-action"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditFeed(feed);
                      }}
                      title="Edit feed"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="feed-item-action"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(feed.id);
                      }}
                      title="Remove feed"
                    >
                      ✕
                    </button>
                  </div>
                  <UnreadCount count={onUnreadCount(feed.id)} />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {feeds.length === 0 && feedLoadStatus === 'success' && (
        <p className="feed-list-empty">No feeds yet. Add one to get started.</p>
      )}

      {(loading || feedLoadStatus === 'loading') && (
        <p className="feed-list-loading">Loading feeds...</p>
      )}

      <nav className="feed-settings-navigation" aria-label="Application">
        <button
          type="button"
          className={`feed-settings-button${settingsActive ? ' active' : ''}`}
          onClick={onOpenSettings}
          aria-current={settingsActive ? 'page' : undefined}
        >
          <SettingsIcon />
          <span>Settings</span>
        </button>
      </nav>

      {editFeed && (
        <FeedEditDialog
          feed={editFeed}
          onSave={handleEdit}
          onClose={() => setEditFeed(null)}
        />
      )}

      {showOPMLDialog && (
        <OPMLDialog
          onImport={handleOPMLImport}
          onExport={handleOPMLExport}
          onClose={() => setShowOPMLDialog(false)}
        />
      )}
    </div>
  );
};
