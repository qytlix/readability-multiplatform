import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { EntryStats, Feed } from '../../../shared/contracts/feed.types';
import {
  CheckIcon,
  DocumentIcon,
  EditIcon,
  ImportIcon,
  InboxIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  SyncIcon,
  TrashIcon,
} from '../reader/ReaderIcons';
import type { EntryFilter } from '../search/entrySearch';
import { FeedEditDialog } from './FeedEditDialog';
import { OPMLDialog } from './OPMLDialog';
import type { FeedLoadStatus } from './readerState';

type SyncStatus = 'idle' | 'loading' | 'success' | 'error';
type SearchStatus = 'idle' | 'searching' | 'results' | 'no-results' | 'error';

const syncStatusLabels: Record<SyncStatus, string> = {
  idle: '同步全部订阅源',
  loading: '正在同步…',
  success: '同步完成',
  error: '同步失败，点击重试',
};

interface FeedListProps {
  feeds: Feed[];
  selectedFeedId: number | null;
  selectedFilter: EntryFilter;
  searchInput: string;
  searchStatus: SearchStatus;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onSearchInputChange: (query: string) => void;
  onSelectFilter: (filter: EntryFilter) => void;
  onSelectFeed: (feedId: number | null) => void;
  onRefresh: () => Promise<boolean>;
  onLocalRefresh: () => Promise<void>;
  onOpenAddFeed: () => void;
  entryStats: EntryStats;
  loading: boolean;
  feedLoadStatus: FeedLoadStatus;
  settingsActive: boolean;
  onOpenSettings: () => void;
}

export const FeedList = ({
  feeds,
  selectedFeedId,
  selectedFilter,
  searchInput,
  searchStatus,
  searchInputRef,
  onSearchInputChange,
  onSelectFilter,
  onSelectFeed,
  onRefresh,
  onLocalRefresh,
  onOpenAddFeed,
  entryStats,
  loading,
  feedLoadStatus,
  settingsActive,
  onOpenSettings,
}: FeedListProps) => {
  const [editFeed, setEditFeed] = useState<Feed | null>(null);
  const [showOPMLDialog, setShowOPMLDialog] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncProgress, setSyncProgress] = useState<Record<number, string>>({});
  const [syncingFeedIds, setSyncingFeedIds] = useState<Set<number>>(() => new Set());
  const mountedRef = useRef(true);
  const syncInFlightRef = useRef(false);
  const singleSyncInFlightRef = useRef<Set<number>>(new Set());
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unreadCountsByFeed = useMemo(
    () => new Map(entryStats.feeds.map(({ feedId, unread }) => [feedId, unread])),
    [entryStats.feeds],
  );

  const clearSuccessTimer = useCallback(() => {
    if (successTimerRef.current !== null) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!window.shaleAPI) {
      return () => {
        mountedRef.current = false;
      };
    }
    const unsubscribe = window.shaleAPI.feed.onSyncProgress((progress) => {
      if (!mountedRef.current) return;
      setSyncProgress((current) => ({
        ...current,
        [progress.feedId]: progress.status,
      }));

      if (progress.status === 'done' || progress.status === 'error') {
        window.setTimeout(() => {
          if (!mountedRef.current) return;
          setSyncProgress((current) => {
            const next = { ...current };
            delete next[progress.feedId];
            return next;
          });
        }, 3000);
      }
    });

    return () => {
      mountedRef.current = false;
      clearSuccessTimer();
      unsubscribe();
    };
  }, [clearSuccessTimer]);

  const handleSync = useCallback(async () => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    clearSuccessTimer();
    setSyncStatus('loading');

    let succeeded = false;
    try {
      succeeded = await onRefresh();
    } finally {
      syncInFlightRef.current = false;
    }
    if (!mountedRef.current) return;

    if (!succeeded) {
      setSyncStatus('error');
      return;
    }
    setSyncStatus('success');
    successTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setSyncStatus('idle');
      successTimerRef.current = null;
    }, 1600);
  }, [clearSuccessTimer, onRefresh]);

  const handleSingleSync = useCallback(async (feedId: number) => {
    if (singleSyncInFlightRef.current.has(feedId)) return;
    singleSyncInFlightRef.current.add(feedId);
    setSyncingFeedIds((current) => new Set(current).add(feedId));

    try {
      const result = await window.shaleAPI.feed.sync(feedId);
      if (result.ok) await onLocalRefresh();
    } finally {
      singleSyncInFlightRef.current.delete(feedId);
      if (mountedRef.current) {
        setSyncingFeedIds((current) => {
          const next = new Set(current);
          next.delete(feedId);
          return next;
        });
      }
    }
  }, [onLocalRefresh]);

  const handleEdit = useCallback(async (
    params: { title?: string; siteURL?: string; syncIntervalMin?: number },
  ) => {
    if (!editFeed) return;
    const result = await window.shaleAPI.feed.update(editFeed.id, params);
    if (!result.ok) throw new Error(result.error.message);
    await onLocalRefresh();
  }, [editFeed, onLocalRefresh]);

  const handleRemove = useCallback(async (feedId: number) => {
    if (!window.confirm('移除此订阅源？它的本地文章也会被删除。')) return;
    const result = await window.shaleAPI.feed.remove(feedId);
    if (!result.ok) return;
    if (selectedFeedId === feedId) onSelectFeed(null);
    await onLocalRefresh();
  }, [onLocalRefresh, onSelectFeed, selectedFeedId]);

  const handleOPMLImport = useCallback(async (
    filePath: string,
    mode: 'merge' | 'replace',
  ) => {
    const result = await window.shaleAPI.opml.import(filePath, mode);
    if (!result.ok) throw new Error(result.error.message);
    await onRefresh();
    return result.data;
  }, [onRefresh]);

  const handleOPMLExport = useCallback(async (filePath: string) => {
    const result = await window.shaleAPI.opml.export(filePath);
    if (!result.ok) throw new Error(result.error.message);
  }, []);

  const allSelected = selectedFeedId === null
    && selectedFilter === 'all'
    && !settingsActive
    && searchInput.trim().length === 0;
  const activeRangeIndex = settingsActive
    || selectedFeedId !== null
    || searchInput.trim().length > 0
    ? null
    : selectedFilter === 'all'
      ? 0
      : selectedFilter === 'unread'
        ? 1
        : 2;

  return (
    <div className="sidebar-content">
      <label className="sidebar-search">
        <SearchIcon />
        <input
          ref={searchInputRef}
          type="search"
          value={searchInput}
          placeholder="搜索本地文章"
          aria-label="搜索本地文章"
          data-entry-search
          onChange={(event) => onSearchInputChange(event.target.value)}
        />
        {searchStatus !== 'idle' && (
          <span
            className={`sidebar-search-status is-${searchStatus}`}
            aria-label={searchStatus === 'searching' ? '正在搜索' : undefined}
          >
            {searchStatus === 'searching' && <span className="mini-spinner" />}
            {(searchStatus === 'results' || searchStatus === 'no-results') && <CheckIcon />}
            {searchStatus === 'error' && <span aria-hidden="true">!</span>}
          </span>
        )}
      </label>

      <nav
        className={[
          'sidebar-navigation',
          activeRangeIndex === null
            ? 'is-indicator-hidden'
            : `is-indicator-at-${activeRangeIndex}`,
        ].join(' ')}
        aria-label="文章范围"
      >
        <span className="sidebar-navigation-indicator" aria-hidden="true" />
        <button
          type="button"
          className={`sidebar-item sidebar-all${allSelected ? ' is-active' : ''}`}
          onClick={() => {
            onSelectFeed(null);
            onSelectFilter('all');
          }}
        >
          <DocumentIcon />
          <span>全部文章</span>
          <span className="sidebar-count">{entryStats.all.total}</span>
        </button>
        <button
          type="button"
          className={`sidebar-item${selectedFilter === 'unread' && !settingsActive ? ' is-active' : ''}`}
          onClick={() => onSelectFilter('unread')}
        >
          <InboxIcon />
          <span>未读</span>
          <span className="sidebar-count">{entryStats.all.unread}</span>
        </button>
        <button
          type="button"
          className={`sidebar-item${selectedFilter === 'starred' && !settingsActive ? ' is-active' : ''}`}
          onClick={() => onSelectFilter('starred')}
        >
          <StarIcon />
          <span>收藏</span>
        </button>
      </nav>

      <section className="sidebar-feed-section" aria-labelledby="feed-heading">
        <div className="sidebar-section-heading">
          <h2 id="feed-heading">订阅源</h2>
          <div className="sidebar-section-actions">
            <button
              type="button"
              className={`icon-button sync-button is-${syncStatus}`}
              aria-label={syncStatusLabels[syncStatus]}
              title={syncStatusLabels[syncStatus]}
              aria-busy={syncStatus === 'loading'}
              onClick={() => void handleSync()}
            >
              {syncStatus === 'success' ? <CheckIcon /> : <SyncIcon />}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="添加订阅源"
              title="添加订阅源"
              onClick={onOpenAddFeed}
            >
              <PlusIcon />
            </button>
          </div>
        </div>

        {syncStatus === 'error' && (
          <button
            type="button"
            className="sidebar-inline-error"
            onClick={() => void handleSync()}
          >
            同步失败，点击重试
          </button>
        )}

        <div className="sidebar-feed-list">
          {feeds.map((feed) => {
            const feedName = feed.title ?? feed.feedURL;
            const progress = syncProgress[feed.id];
            const unreadCount = unreadCountsByFeed.get(feed.id) ?? 0;
            const isSingleSyncing = syncingFeedIds.has(feed.id);
            const hasVisibleProgress = progress === 'fetching'
              || progress === 'parsing'
              || progress === 'saving'
              || progress === 'done';
            return (
              <div className="sidebar-feed-row" key={feed.id}>
                <button
                  type="button"
                  className={`sidebar-item sidebar-feed${
                    selectedFeedId === feed.id && !settingsActive ? ' is-active' : ''
                  }`}
                  onClick={() => onSelectFeed(feed.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setEditFeed(feed);
                  }}
                >
                  <span className="sidebar-feed-name" title={feedName}>{feedName}</span>
                  <span
                    className="sidebar-count sidebar-feed-unread-count"
                    aria-label={hasVisibleProgress
                      ? undefined
                      : `${unreadCount} 篇未读文章`}
                  >
                    {hasVisibleProgress
                      ? progress === 'done' ? '✓' : <span className="mini-spinner" />
                      : unreadCount}
                  </span>
                </button>
                <div className="sidebar-feed-actions">
                  <button
                    type="button"
                    className={`sync-button${isSingleSyncing ? ' is-loading' : ''}`}
                    aria-label={`同步 ${feedName}`}
                    title="同步此订阅源"
                    aria-busy={isSingleSyncing}
                    disabled={isSingleSyncing}
                    onClick={() => void handleSingleSync(feed.id)}
                  >
                    <SyncIcon />
                  </button>
                  <button
                    type="button"
                    aria-label={`编辑 ${feedName}`}
                    title="编辑订阅源"
                    onClick={() => setEditFeed(feed)}
                  >
                    <EditIcon />
                  </button>
                  <button
                    type="button"
                    aria-label={`移除 ${feedName}`}
                    title="移除订阅源"
                    onClick={() => void handleRemove(feed.id)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {feeds.length === 0 && feedLoadStatus === 'success' && (
          <div className="sidebar-empty">
            <p>还没有订阅源</p>
            <button type="button" onClick={onOpenAddFeed}>添加第一个订阅</button>
          </div>
        )}
        {(loading || feedLoadStatus === 'loading') && (
          <p className="sidebar-loading"><span className="mini-spinner" /> 正在载入</p>
        )}
      </section>

      <nav className="sidebar-footer-navigation" aria-label="应用">
        <button
          type="button"
          className="sidebar-footer-button"
          onClick={() => setShowOPMLDialog(true)}
        >
          <ImportIcon />
          <span>导入 / 导出 OPML</span>
        </button>
        <button
          type="button"
          className={`sidebar-footer-button${settingsActive ? ' is-active' : ''}`}
          aria-current={settingsActive ? 'page' : undefined}
          onClick={onOpenSettings}
        >
          <SettingsIcon />
          <span>AI 设置</span>
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
