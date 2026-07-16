import { useState, useEffect, useCallback } from 'react';
import type { Feed } from '../shared/contracts/feed.types';
import type { EntryListItem } from '../shared/contracts/feed.types';
import type { Entry } from '../shared/contracts/feed.types';
import { FeedList } from './features/feeds/FeedList';
import { EntryList } from './features/feeds/EntryList';
import { EntryDetail } from './features/feeds/EntryDetail';
import { FeedAddDialog } from './features/feeds/FeedAddDialog';
import {
  type EntryLoadStatus,
  type FeedLoadStatus,
} from './features/feeds/readerState';
import { WorkspaceLayout } from './features/layout/WorkspaceLayout';
import shaleMark from './assets/brand/shale-mark.svg';

export const App = () => {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [selectedFeedId, setSelectedFeedId] = useState<number | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [loadingFeeds, setLoadingFeeds] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [feedLoadStatus, setFeedLoadStatus] = useState<FeedLoadStatus>('loading');
  const [feedLoadError, setFeedLoadError] = useState('');
  const [entryLoadStatus, setEntryLoadStatus] = useState<EntryLoadStatus>('loading');
  const [entryLoadError, setEntryLoadError] = useState('');
  const [showAddFeedDialog, setShowAddFeedDialog] = useState(false);
  const [entriesCursor, setEntriesCursor] = useState<
    { publishedAt: string; id: number } | undefined
  >(undefined);
  const [hasMoreEntries, setHasMoreEntries] = useState(true);

  const loadFeeds = useCallback(async (showLoadingState = true) => {
    setLoadingFeeds(true);
    if (showLoadingState) {
      setFeedLoadStatus('loading');
      setFeedLoadError('');
    }
    try {
      const result = await window.shaleAPI.feed.list();
      if (!result.ok) {
        console.error('Failed to load feeds:', result.error);
        setFeedLoadStatus('error');
        setFeedLoadError(result.error?.message ?? 'Unable to load feeds.');
        return false;
      }
      setFeeds(result.data);
      setFeedLoadStatus('success');
      return true;
    } catch (err) {
      console.error('Failed to load feeds:', err);
      setFeedLoadStatus('error');
      setFeedLoadError('Unable to load feeds.');
      return false;
    } finally {
      setLoadingFeeds(false);
    }
  }, []);

  const loadEntries = useCallback(
    async (reset = false) => {
      setLoadingEntries(true);
      if (reset) {
        setEntryLoadStatus('loading');
        setEntryLoadError('');
      }
      try {
        const params: any = {
          limit: 30,
        };
        if (selectedFeedId !== null) params.feedId = selectedFeedId;
        if (!reset && entriesCursor) params.cursor = entriesCursor;

        const result = await window.shaleAPI.entry.list(params);
        if (!result.ok) {
          console.error('Failed to load entries:', result.error);
          if (reset) {
            setEntryLoadStatus('error');
            setEntryLoadError(result.error?.message ?? 'Unable to load articles.');
          }
          return false;
        }

        const data = result.data;

        if (reset) {
          setEntries(data.entries);
        } else {
          setEntries((prev) => [...prev, ...data.entries]);
        }
        setEntriesCursor(data.nextCursor);
        setHasMoreEntries(!!data.nextCursor);
        setEntryLoadStatus('success');
        return true;
      } catch (err) {
        console.error('Failed to load entries:', err);
        if (reset) {
          setEntryLoadStatus('error');
          setEntryLoadError('Unable to load articles.');
        }
        return false;
      } finally {
        setLoadingEntries(false);
      }
    },
    [selectedFeedId, entriesCursor],
  );

  // Load feeds on mount
  useEffect(() => {
    loadFeeds();
  }, [loadFeeds]);

  // Reset entries when feed selection changes
  useEffect(() => {
    setEntries([]);
    setEntriesCursor(undefined);
    setHasMoreEntries(true);
    setSelectedEntryId(null);
    setSelectedEntry(null);
    if (selectedFeedId !== null || selectedFeedId === null) {
      loadEntries(true);
    }
  }, [selectedFeedId]);

  const handleSelectEntry = useCallback(
    async (entryId: number) => {
      setSelectedEntryId(entryId);

      // Find entry details from the list
      const listEntry = entries.find((e) => e.id === entryId);
      if (listEntry) {
        setSelectedEntry({
          id: listEntry.id,
          feedId: listEntry.feedId,
          title: listEntry.title,
          author: listEntry.author,
          publishedAt: listEntry.publishedAt,
          createdAt: listEntry.createdAt,
          isRead: true,
          isStarred: false,
          isDeleted: false,
          updatedAt: listEntry.createdAt,
          summary: listEntry.summary,
        });
      }
    },
    [entries],
  );

  const handleLoadMore = useCallback(() => {
    if (hasMoreEntries && !loadingEntries) {
      loadEntries(false);
    }
  }, [hasMoreEntries, loadingEntries, loadEntries]);

  /** Reload feeds and entries from local DB only — no network sync. */
  const reloadLocalData = useCallback(async () => {
    await loadFeeds(false);
    setEntries([]);
    setEntriesCursor(undefined);
    setHasMoreEntries(true);
    await loadEntries(true);
  }, [loadFeeds, loadEntries]);

  const handleSyncAll = useCallback(async () => {
    setLoadingFeeds(true);
    try {
      const syncResult = await window.shaleAPI.feed.sync();
      if (!syncResult.ok) {
        console.error('Sync failed:', syncResult.error);
        return false;
      }

      const feedsLoaded = await loadFeeds(false);
      if (!feedsLoaded) return false;
      // Reload entries for current feed
      setEntries([]);
      setEntriesCursor(undefined);
      setHasMoreEntries(true);
      await loadEntries(true);
      return true;
    } catch (err) {
      console.error('Sync failed:', err);
      return false;
    } finally {
      setLoadingFeeds(false);
    }
  }, [loadFeeds, loadEntries]);

  const handleOpenAddFeedDialog = useCallback(() => {
    setShowAddFeedDialog(true);
  }, []);

  const handleAddFeed = useCallback(async (url: string) => {
    const result = await window.shaleAPI.feed.add(url);
    if (!result.ok) {
      throw new Error(result.error?.message ?? 'Unknown error');
    }
    const syncSucceeded = await handleSyncAll();
    if (!syncSucceeded) {
      await loadFeeds();
    }
  }, [handleSyncAll, loadFeeds]);

  const hasNoFeeds = feedLoadStatus === 'success' && feeds.length === 0;
  const visibleEntries = hasNoFeeds ? [] : entries;

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <img className="app-brand-mark" src={shaleMark} alt="" />
          <span>Shale</span>
        </h1>
      </header>

      <WorkspaceLayout
        feedPane={(
          <FeedList
            feeds={feeds}
            selectedFeedId={selectedFeedId}
            onSelectFeed={(feedId) => {
              setSelectedFeedId(feedId);
            }}
            onRefresh={handleSyncAll}
            onLocalRefresh={reloadLocalData}
            onOpenAddFeed={handleOpenAddFeedDialog}
            onUnreadCount={(feedId) => {
              // Simplified: count unread in current entries list
              // In full implementation, use entryStore.countUnread via IPC
              return visibleEntries.filter(
                (e) => e.feedId === feedId && !e.isRead,
              ).length;
            }}
            loading={loadingFeeds}
            feedLoadStatus={feedLoadStatus}
          />
        )}
        entryPane={(
          <EntryList
            entries={visibleEntries}
            selectedEntryId={selectedEntryId}
            feedId={selectedFeedId}
            loading={loadingEntries}
            onSelectEntry={handleSelectEntry}
            onLoadMore={handleLoadMore}
            hasMore={hasNoFeeds ? false : hasMoreEntries}
          />
        )}
        readerPane={(
          <EntryDetail
            entry={selectedEntry}
            feedLoadStatus={feedLoadStatus}
            feedLoadError={feedLoadError}
            feedCount={feeds.length}
            entryLoadStatus={entryLoadStatus}
            entryLoadError={entryLoadError}
            entryCount={visibleEntries.length}
            onAddFeed={handleOpenAddFeedDialog}
            onRetryFeeds={() => {
              void loadFeeds();
            }}
            onRetryEntries={() => {
              void loadEntries(true);
            }}
          />
        )}
      />

      {showAddFeedDialog && (
        <FeedAddDialog
          onAdd={handleAddFeed}
          onClose={() => setShowAddFeedDialog(false)}
        />
      )}
    </div>
  );
};
