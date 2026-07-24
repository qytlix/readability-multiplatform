import {
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import type { EntryListItem } from '../../../shared/contracts/feed.types';
import { FilterIcon, SearchIcon } from '../reader/ReaderIcons';
import type { EntryFilter } from '../search/entrySearch';
import { getReadingProgressPercentage } from './readingProgress';
import type { EntryLoadStatus } from './readerState';

type SearchStatus = 'idle' | 'searching' | 'results' | 'no-results' | 'error';

interface EntryListProps {
  entries: EntryListItem[];
  selectedEntryId: number | null;
  heading: string;
  loading: boolean;
  loadStatus: EntryLoadStatus;
  loadError: string;
  searchQuery: string;
  searchStatus: SearchStatus;
  filter: EntryFilter;
  onFilterChange: (filter: EntryFilter) => void;
  onSelectEntry: (entryId: number) => void;
  onLoadMore: () => void;
  hasMore: boolean;
}

const nextFilter = (filter: EntryFilter): EntryFilter => {
  if (filter === 'all') return 'unread';
  if (filter === 'unread') return 'starred';
  return 'all';
};

export const EntryList = ({
  entries,
  selectedEntryId,
  heading,
  loading,
  loadStatus,
  loadError,
  searchQuery,
  searchStatus,
  filter,
  onFilterChange,
  onSelectEntry,
  onLoadMore,
  hasMore,
}: EntryListProps) => {
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const selectionIndicatorRef = useRef<HTMLSpanElement>(null);
  const storyCardRefs = useRef(new Map<number, HTMLButtonElement>());

  useEffect(() => {
    if (!hasMore || loading || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((observed) => {
      if (observed[0]?.isIntersecting) onLoadMore();
    }, { threshold: 0.1 });
    const element = loadMoreRef.current;
    if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  useLayoutEffect(() => {
    const indicator = selectionIndicatorRef.current;
    const selectedCard = selectedEntryId === null
      ? undefined
      : storyCardRefs.current.get(selectedEntryId);
    if (!indicator || !selectedCard) {
      if (indicator) indicator.style.opacity = '0';
      return;
    }

    const updateIndicator = (): void => {
      indicator.style.height = `${selectedCard.offsetHeight}px`;
      indicator.style.transform = `translateY(${selectedCard.offsetTop}px)`;
      indicator.style.opacity = '1';
    };

    updateIndicator();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateIndicator);
    observer.observe(selectedCard);
    return () => observer.disconnect();
  }, [entries, selectedEntryId]);

  const showsSearch = searchQuery.trim().length > 0;
  const showInitialLoading = loadStatus === 'loading' && entries.length === 0;
  const showError = loadStatus === 'error' && entries.length === 0;
  const showEmpty = !loading && entries.length === 0 && !showError;

  return (
    <div className="story-list">
      <header className="story-list-header">
        <div>
          <h1 title={heading}>{heading}</h1>
        </div>
        {!showsSearch && (
          <button
            type="button"
            className="icon-button story-list-filter"
            aria-label={`切换文章筛选，当前为 ${filter}`}
            title="切换：全部 / 未读 / 收藏"
            onClick={() => onFilterChange(nextFilter(filter))}
          >
            <FilterIcon />
          </button>
        )}
      </header>

      <div className="story-list-meta">
        <span>{entries.length} 篇文章{hasMore ? '+' : ''}</span>
      </div>

      <div className="story-cards">
        <span
          ref={selectionIndicatorRef}
          className="story-selection-indicator"
          aria-hidden="true"
        />
        {entries.map((entry) => {
          const readingPercentage = getReadingProgressPercentage(entry.readingProgress);
          return (
            <button
              type="button"
              key={entry.id}
              ref={(element) => {
                if (element) storyCardRefs.current.set(entry.id, element);
                else storyCardRefs.current.delete(entry.id);
              }}
              className={`story-card${selectedEntryId === entry.id ? ' is-active' : ''}`}
              aria-pressed={selectedEntryId === entry.id}
              onClick={() => onSelectEntry(entry.id)}
            >
              <div className="story-card-copy">
                <div className="story-card-title">
                  <h2>{entry.title ?? '无标题文章'}</h2>
                  <span
                    className="story-card-reading-progress"
                    aria-label={`阅读进度 ${readingPercentage}%`}
                    title={`阅读进度：${readingPercentage}%`}
                  >
                    {readingPercentage}%
                  </span>
                </div>
                {entry.summary && <p>{entry.summary}</p>}
              </div>
            </button>
          );
        })}

        {showInitialLoading && (
          <div className="story-list-state">
            <span className="reader-spinner" />
            <h2>{showsSearch ? '正在搜索本地文章' : '正在读取本地资料库'}</h2>
            <p>所有内容都从这台设备加载。</p>
          </div>
        )}

        {showError && (
          <div className="story-list-state is-error">
            <span aria-hidden="true">!</span>
            <h2>{showsSearch ? '搜索失败' : '文章载入失败'}</h2>
            <p>{loadError || '请稍后重试。'}</p>
          </div>
        )}

        {showEmpty && (
          <div className="story-list-state">
            <SearchIcon />
            <h2>
              {searchStatus === 'searching'
                ? '正在搜索'
                : showsSearch
                  ? `没有找到“${searchQuery}”`
                  : filter === 'unread'
                    ? '没有未读文章'
                    : filter === 'starred'
                      ? '还没有收藏文章'
                      : '这里还没有文章'}
            </h2>
            <p>
              {showsSearch
                ? '换个关键词试试；搜索仅使用已经保存到本地的内容。'
                : '同步订阅源后，新文章会出现在这里。'}
            </p>
          </div>
        )}

        {hasMore && entries.length > 0 && (
          <div ref={loadMoreRef} className="story-list-load-more">
            {loading ? <><span className="mini-spinner" /> 正在加载</> : '继续滚动以加载更多'}
          </div>
        )}
      </div>
    </div>
  );
};
