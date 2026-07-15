import { useState, useEffect, useCallback, useRef } from 'react';
import type { Feed } from '../shared/contracts/feed.types';
import type { EntryListItem } from '../shared/contracts/feed.types';
import type { Entry } from '../shared/contracts/feed.types';
import { FeedList } from './features/feeds/FeedList';
import { EntryList } from './features/feeds/EntryList';
import { EntryDetail } from './features/feeds/EntryDetail';

export const App = () => {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [selectedFeedId, setSelectedFeedId] = useState<number | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [loadingFeeds, setLoadingFeeds] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [entriesCursor, setEntriesCursor] = useState<
    { publishedAt: string; id: number } | undefined
  >(undefined);
  const [hasMoreEntries, setHasMoreEntries] = useState(true);
  const [ipcStatus, setIpcStatus] = useState<string>('');

  const loadFeeds = useCallback(async () => {
    setLoadingFeeds(true);
    try {
      const result = await window.shaleAPI.feed.list();
      if (!result.ok) {
        console.error('Failed to load feeds:', result.error);
        return;
      }
      setFeeds(result.data);
    } catch (err) {
      console.error('Failed to load feeds:', err);
    } finally {
      setLoadingFeeds(false);
    }
  }, []);

  const loadEntries = useCallback(
    async (reset = false) => {
      setLoadingEntries(true);
      try {
        const params: any = {
          limit: 30,
        };
        if (selectedFeedId !== null) params.feedId = selectedFeedId;
        if (!reset && entriesCursor) params.cursor = entriesCursor;

        const result = await window.shaleAPI.entry.list(params);
        if (!result.ok) {
          console.error('Failed to load entries:', result.error);
          return;
        }

        const data = result.data;

        if (reset) {
          setEntries(data.entries);
        } else {
          setEntries((prev) => [...prev, ...data.entries]);
        }
        setEntriesCursor(data.nextCursor);
        setHasMoreEntries(!!data.nextCursor);
      } catch (err) {
        console.error('Failed to load entries:', err);
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

  const handleSyncAll = useCallback(async () => {
    setLoadingFeeds(true);
    try {
      await window.shaleAPI.feed.sync();
      await loadFeeds();
      // Reload entries for current feed
      setEntries([]);
      setEntriesCursor(undefined);
      setHasMoreEntries(true);
      await loadEntries(true);
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setLoadingFeeds(false);
    }
  }, [loadFeeds, loadEntries]);

  const handleTestIpc = useCallback(async () => {
    setIpcStatus('Testing IPC...');
    try {
      const response = await window.shaleAPI.system.ping();
      if (response.ok === true && response.message === 'pong') {
        setIpcStatus('IPC OK: pong');
      } else {
        setIpcStatus('IPC failed');
      }
    } catch {
      setIpcStatus('IPC failed');
    }
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Shale</h1>
        <button type="button" onClick={handleTestIpc}>
          Test IPC
        </button>
        <span className="ipc-status">{ipcStatus}</span>
      </header>

      <div className="app-body">
        <aside className="app-sidebar">
          <FeedList
            feeds={feeds}
            selectedFeedId={selectedFeedId}
            onSelectFeed={(feedId) => {
              setSelectedFeedId(feedId);
            }}
            onRefresh={handleSyncAll}
            onUnreadCount={(feedId) => {
              // Simplified: count unread in current entries list
              // In full implementation, use entryStore.countUnread via IPC
              return entries.filter(
                (e) => e.feedId === feedId && !e.isRead,
              ).length;
            }}
            loading={loadingFeeds}
          />
        </aside>

        <main className="app-main">
          <EntryList
            entries={entries}
            selectedEntryId={selectedEntryId}
            feedId={selectedFeedId}
            loading={loadingEntries}
            onSelectEntry={handleSelectEntry}
            onLoadMore={handleLoadMore}
            hasMore={hasMoreEntries}
          />
        </main>

        <aside className="app-detail">
          <EntryDetail entry={selectedEntry} />
        </aside>
      </div>
    </div>
  );
};