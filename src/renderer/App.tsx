import { useState, useEffect, useCallback } from 'react';
import type { Feed } from '../shared/contracts/feed.types';
import type { EntryListItem } from '../shared/contracts/feed.types';
import type { Entry } from '../shared/contracts/feed.types';
import { FeedList } from './features/feeds/FeedList';
import { EntryList } from './features/feeds/EntryList';
import { EntryDetail } from './features/feeds/EntryDetail';
import { WorkspaceLayout } from './features/layout/WorkspaceLayout';

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
  const [unreadCounts, setUnreadCounts] = useState<Record<number, number>>({});
  const [ipcStatus, setIpcStatus] = useState<string>('');
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

  const loadUnreadCounts = useCallback(
    async (feedsList: Feed[]) => {
      const counts: Record<number, number> = {};
      for (const feed of feedsList) {
        try {
          const result = await window.shaleAPI.entry.list({
            feedId: feed.id,
            isRead: false,
            limit: 1,
          });
          if (result.ok) {
            // Count unread entries (first page counts approximate, but cursor means has more)
            // Actually we need the total. Let's fetch with a larger limit to count more accurately.
            const unreadResult = await window.shaleAPI.entry.list({
              feedId: feed.id,
              isRead: false,
              limit: 100,
            });
            if (unreadResult.ok) {
              let unreadCount = unreadResult.data.entries.length;
              // If there's a nextCursor, there are more — we'll approximate
              if (unreadResult.data.nextCursor) {
                unreadCount = unreadCount + 50; // rough approximation
              }
              counts[feed.id] = unreadCount;
            }
          }
        } catch {
          counts[feed.id] = 0;
        }
      }

      // Total unread
      try {
        const allUnread = await window.shaleAPI.entry.list({
          isRead: false,
          limit: 100,
        });
        if (allUnread.ok) {
          counts[0] = allUnread.data.entries.length;
          if (allUnread.data.nextCursor) {
            counts[0] = counts[0] + 50;
          }
        }
      } catch {
        counts[0] = 0;
      }

      if (isMountedRef.current) {
        setUnreadCounts(counts);
      }
    },
    [],
  );

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

  // Load unread counts when feeds change
  useEffect(() => {
    if (feeds.length > 0) {
      loadUnreadCounts(feeds);
    }
  }, [feeds, loadUnreadCounts]);

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

      // Find and update entry details from the list
      const listEntry = entries.find((e) => e.id === entryId);
      if (listEntry) {
        setSelectedEntry({
          id: listEntry.id,
          feedId: listEntry.feedId,
          title: listEntry.title,
          author: listEntry.author,
          publishedAt: listEntry.publishedAt,
          createdAt: listEntry.createdAt,
          isRead: listEntry.isRead,
          isStarred: listEntry.isStarred,
          isDeleted: false,
          updatedAt: listEntry.createdAt,
          summary: listEntry.summary,
        });

        // Mark as read in backend and update local state
        if (!listEntry.isRead) {
          await window.shaleAPI.entry.markRead([entryId], true);
          // Update local entry list
          setEntries((prev) =>
            prev.map((e) =>
              e.id === entryId ? { ...e, isRead: true } : e,
            ),
          );
          // Update selectedEntry
          setSelectedEntry((prev) =>
            prev ? { ...prev, isRead: true } : prev,
          );
        }
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
      const syncResult = await window.shaleAPI.feed.sync();
      if (!syncResult.ok) {
        console.error('Sync failed:', syncResult.error);
        return false;
      }

      await loadFeeds();
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

      <WorkspaceLayout
        feedPane={(
          <FeedList
            feeds={feeds}
            selectedFeedId={selectedFeedId}
            onSelectFeed={(feedId) => {
              setSelectedFeedId(feedId);
            }}
            onRefresh={handleSyncAll}
            onUnreadCount={(feedId) => {
              return unreadCounts[feedId] ?? 0;
            }}
            loading={loadingFeeds}
          />
        )}
        entryPane={(
          <EntryList
            entries={entries}
            selectedEntryId={selectedEntryId}
            feedId={selectedFeedId}
            loading={loadingEntries}
            onSelectEntry={handleSelectEntry}
            onLoadMore={handleLoadMore}
            hasMore={hasMoreEntries}
          />
        )}
        readerPane={<EntryDetail entry={selectedEntry} />}
      />
    </div>
  );
};
