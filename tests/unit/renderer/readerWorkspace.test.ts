// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EntryCursor,
  EntryListItem,
  EntryStats,
  Feed,
} from '../../../src/shared/contracts/feed.types';
import {
  useReaderWorkspace,
  type ReaderWorkspace,
} from '../../../src/renderer/features/reader/useReaderWorkspace';

const feed: Feed = {
  id: 1,
  title: 'Daily Feed',
  feedURL: 'https://example.com/feed.xml',
  lastSyncStatus: 'success',
  syncIntervalMin: 30,
  createdAt: '2026-07-28T00:00:00.000Z',
};

const secondaryFeed: Feed = {
  ...feed,
  id: 2,
  title: 'Science Feed',
  feedURL: 'https://example.com/science.xml',
};

const entryA: EntryListItem = {
  id: 11,
  feedId: feed.id,
  feedTitle: feed.title,
  title: '文章 A',
  url: 'https://example.com/a',
  createdAt: '2026-07-28T01:00:00.000Z',
  isRead: false,
  readingProgress: 0,
  isStarred: false,
  pipelineStatus: 'success',
};

const entryB: EntryListItem = {
  ...entryA,
  id: 12,
  title: '文章 B',
  url: 'https://example.com/b',
};

const entryStats: EntryStats = {
  all: { total: 2, unread: 2, readPercentage: 0 },
  feeds: [
    { feedId: feed.id, total: 2, unread: 2, readPercentage: 0 },
  ],
  tagCount: 1,
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
};

describe('Reader 工作区', () => {
  let container: HTMLDivElement;
  let root: Root;
  let workspace: ReaderWorkspace;
  let listEntries: ReturnType<typeof vi.fn>;
  let feedback: (message: string) => void;
  let updateReadingProgress: ReturnType<typeof vi.fn>;
  let markRead: ReturnType<typeof vi.fn>;
  let markStarred: ReturnType<typeof vi.fn>;

  const flushAsyncState = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const renderWorkspace = async (): Promise<void> => {
    const Harness = () => {
      workspace = useReaderWorkspace({ onFeedback: feedback });
      return null;
    };
    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });
    await flushAsyncState();
  };

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    feedback = vi.fn();
    listEntries = vi.fn().mockResolvedValue({
      ok: true,
      data: { entries: [entryA], nextCursor: undefined },
    });
    updateReadingProgress = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        readingProgress: 0.75,
        isRead: true,
        becameRead: false,
      },
    });
    markRead = vi.fn().mockResolvedValue({ ok: true, data: undefined });
    markStarred = vi.fn().mockResolvedValue({ ok: true, data: undefined });
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        feed: {
          list: vi.fn().mockResolvedValue({ ok: true, data: [feed, secondaryFeed] }),
          sync: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
          add: vi.fn().mockResolvedValue({ ok: true, data: feed }),
        },
        entry: {
          list: listEntries,
          stats: vi.fn().mockResolvedValue({ ok: true, data: entryStats }),
          updateReadingProgress,
          markRead,
          markStarred,
        },
      } as unknown as typeof window.shaleAPI,
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('通过一个 Interface 完成目录与首屏文章加载', async () => {
    await renderWorkspace();

    expect(workspace.state.feeds).toEqual([feed, secondaryFeed]);
    expect(workspace.state.entries).toEqual([entryA]);
    expect(workspace.state.entryStats).toEqual(entryStats);
    expect(workspace.state.feedLoadStatus).toBe('success');
    expect(workspace.state.entryLoadStatus).toBe('success');
  });

  it('阅读上下文变化时丢弃过期响应并清除文章选择', async () => {
    const firstRequest = deferred<{
      ok: true;
      data: { entries: EntryListItem[]; nextCursor: undefined };
    }>();
    const secondRequest = deferred<{
      ok: true;
      data: { entries: EntryListItem[]; nextCursor: undefined };
    }>();

    await renderWorkspace();
    act(() => workspace.actions.selectEntry(entryA.id));
    expect(workspace.state.selectedEntry?.id).toBe(entryA.id);

    listEntries
      .mockReset()
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise);
    act(() => workspace.actions.selectSidebarFilter('unread'));
    await flushAsyncState();
    act(() => workspace.actions.selectFeed(secondaryFeed.id));
    await flushAsyncState();
    secondRequest.resolve({
      ok: true,
      data: { entries: [entryB], nextCursor: undefined },
    });
    await flushAsyncState();
    firstRequest.resolve({
      ok: true,
      data: { entries: [entryA], nextCursor: undefined },
    });
    await flushAsyncState();

    expect(workspace.state.selectedFeedId).toBe(secondaryFeed.id);
    expect(workspace.state.entryFilter).toBe('all');
    expect(workspace.state.selectedEntry).toBeNull();
    expect(workspace.state.entries).toEqual([entryB]);
  });

  it('搜索防抖完成后才应用查询并请求新上下文', async () => {
    vi.useFakeTimers();
    await renderWorkspace();
    listEntries.mockClear();

    act(() => workspace.actions.setSearchInput(' climate '));
    expect(workspace.state.appliedSearchQuery).toBe('');
    expect(workspace.state.effectiveSearchStatus).toBe('searching');

    await act(async () => {
      vi.advanceTimersByTime(299);
      await Promise.resolve();
    });
    expect(listEntries).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(workspace.state.appliedSearchQuery).toBe('climate');
    expect(listEntries).toHaveBeenCalledWith(expect.objectContaining({
      search: 'climate',
    }));
  });

  it('分页追加文章并在到达末页后停止加载', async () => {
    const cursor: EntryCursor = {
      publishedAt: '2026-07-28T00:00:00.000Z',
      id: entryA.id,
    };
    listEntries
      .mockReset()
      .mockResolvedValueOnce({
        ok: true,
        data: { entries: [entryA], nextCursor: cursor },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { entries: [entryB], nextCursor: undefined },
      });

    await renderWorkspace();
    expect(workspace.state.hasMoreEntries).toBe(true);

    act(() => workspace.actions.loadMore());
    await flushAsyncState();

    expect(workspace.state.entries).toEqual([entryA, entryB]);
    expect(workspace.state.hasMoreEntries).toBe(false);
    expect(listEntries).toHaveBeenLastCalledWith(expect.objectContaining({
      cursor,
    }));
  });

  it('切换 Feed 时集中重置筛选、多选与文章选择', async () => {
    await renderWorkspace();
    act(() => {
      workspace.actions.selectEntry(entryA.id);
      workspace.actions.setSelectionMode(true);
      workspace.actions.toggleSelectedId(entryA.id);
      workspace.actions.selectFeed(secondaryFeed.id);
    });
    await flushAsyncState();

    expect(workspace.state.selectedFeedId).toBe(secondaryFeed.id);
    expect(workspace.state.entryFilter).toBe('all');
    expect(workspace.state.selectedEntry).toBeNull();
    expect(workspace.state.selectionMode).toBe(false);
    expect(workspace.state.selectedIds.size).toBe(0);
  });

  it('从同一 Interface 同步文章列表与当前文章状态', async () => {
    await renderWorkspace();
    act(() => workspace.actions.selectEntry(entryA.id));

    await act(async () => {
      await workspace.actions.markRead();
    });
    expect(markRead).toHaveBeenCalledWith([entryA.id], true);
    expect(workspace.state.entries[0].isRead).toBe(true);
    expect(workspace.state.selectedEntry?.isRead).toBe(true);

    await act(async () => {
      await workspace.actions.toggleStarred();
    });
    expect(markStarred).toHaveBeenCalledWith(entryA.id, true);
    expect(workspace.state.entries[0].isStarred).toBe(true);
    expect(workspace.state.selectedEntry?.isStarred).toBe(true);

    await act(async () => {
      await workspace.actions.updateReadingProgress(entryA.id, 0.75);
    });
    expect(updateReadingProgress).toHaveBeenCalledWith(entryA.id, 0.75);
    expect(workspace.state.entries[0].readingProgress).toBe(0.75);
    expect(workspace.state.selectedEntry?.readingProgress).toBe(0.75);
  });
});
