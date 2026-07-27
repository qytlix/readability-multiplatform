// @vitest-environment jsdom

import { act, createElement, forwardRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EntryListItem,
  EntryStats,
  Feed,
} from '../../../src/shared/contracts/feed.types';

vi.mock('../../../src/renderer/features/summary/SummaryPanel', () => ({
  SummaryPanel: forwardRef(() => null),
}));

vi.mock('../../../src/renderer/features/translation/TranslationPanel', () => ({
  TranslationPanel: forwardRef(() => null),
}));

vi.mock('../../../src/renderer/features/translation/InlineTranslationOverlay', () => ({
  InlineTranslationOverlay: () => null,
}));

import { App } from '../../../src/renderer/App';

const feed: Feed = {
  id: 1,
  title: 'Daily Feed',
  feedURL: 'https://example.com/feed.xml',
  lastSyncStatus: 'success',
  syncIntervalMin: 30,
  createdAt: '2026-07-24T00:00:00.000Z',
};

const secondaryFeed: Feed = {
  id: 2,
  title: 'Engineering Notes',
  feedURL: 'https://example.com/engineering.xml',
  lastSyncStatus: 'success',
  syncIntervalMin: 30,
  createdAt: '2026-07-24T00:00:00.000Z',
};

const entries: EntryListItem[] = [
  {
    id: 11,
    feedId: feed.id,
    feedTitle: feed.title,
    title: '文章 A',
    url: 'https://example.com/a',
    createdAt: '2026-07-24T01:00:00.000Z',
    isRead: false,
    readingProgress: 0.35,
    isStarred: false,
    pipelineStatus: 'success',
  },
  {
    id: 12,
    feedId: feed.id,
    feedTitle: feed.title,
    title: '文章 B',
    url: 'https://example.com/b',
    createdAt: '2026-07-24T00:00:00.000Z',
    isRead: true,
    readingProgress: 1,
    isStarred: false,
    pipelineStatus: 'success',
  },
];

const entryStats: EntryStats = {
  all: { total: 2, unread: 1, readPercentage: 50 },
  feeds: [
    { feedId: feed.id, total: 2, unread: 1, readPercentage: 50 },
    { feedId: secondaryFeed.id, total: 0, unread: 0, readPercentage: 0 },
  ],
  tagCount: 0,
};

const findStoryCard = (
  container: ParentNode,
  title: string,
): HTMLButtonElement | undefined => (
  [...container.querySelectorAll<HTMLButtonElement>('.story-card')]
    .find((card) => card.querySelector('h2')?.textContent === title)
);

describe('article selection toggle', () => {
  let container: HTMLDivElement;
  let root: Root;
  let listEntries: ReturnType<typeof vi.fn>;
  let getContent: ReturnType<typeof vi.fn>;
  let fetchAndClean: ReturnType<typeof vi.fn>;
  let unsubscribeSyncProgress: ReturnType<typeof vi.fn>;

  const flushAsyncState = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    vi.stubGlobal('ResizeObserver', class ResizeObserver {
      observe = vi.fn();

      disconnect = vi.fn();

      unobserve = vi.fn();
    });
    listEntries = vi.fn(async (query: { feedId?: number; isRead?: boolean } = {}) => ({
      ok: true,
      data: {
        entries: query.feedId === secondaryFeed.id && query.isRead === false
          ? []
          : entries,
        nextCursor: undefined,
      },
    }));
    getContent = vi.fn(() => new Promise(() => undefined));
    fetchAndClean = vi.fn();
    unsubscribeSyncProgress = vi.fn();
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        feed: {
          list: vi.fn(async () => ({ ok: true, data: [feed, secondaryFeed] })),
          onSyncProgress: vi.fn(() => unsubscribeSyncProgress),
        },
        entry: {
          list: listEntries,
          stats: vi.fn(async () => ({ ok: true, data: entryStats })),
          updateReadingProgress: vi.fn(),
          markRead: vi.fn(),
          markStarred: vi.fn(),
        },
        content: {
          get: getContent,
          fetchAndClean,
        },
        annotation: {
          list: vi.fn().mockResolvedValue({ ok: true, data: [] }),
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
    vi.unstubAllGlobals();
  });

  it('deselects the active article without changing list context or scroll position', async () => {
    await act(async () => {
      root.render(createElement(App));
      await Promise.resolve();
    });
    await flushAsyncState();

    const feedButton = container.querySelector<HTMLButtonElement>('.sidebar-feed');
    expect(feedButton).not.toBeNull();
    act(() => feedButton?.click());
    await flushAsyncState();

    const storyCards = container.querySelector<HTMLDivElement>('.story-cards');
    const articleA = findStoryCard(container, '文章 A');
    const articleB = findStoryCard(container, '文章 B');
    expect(storyCards).not.toBeNull();
    expect(articleA).toBeDefined();
    expect(articleB).toBeDefined();
    if (!storyCards || !articleA || !articleB) return;

    storyCards.scrollTop = 146;
    const listRequestCount = listEntries.mock.calls.length;

    act(() => articleA.click());
    expect(articleA.classList.contains('is-active')).toBe(true);
    expect(articleA.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).not.toContain('选择一篇文章开始阅读');
    expect(container.querySelector('.entry-detail-title-row h2')?.textContent).toBe('文章 A');

    act(() => articleA.click());
    expect(container.querySelector('.story-card.is-active')).toBeNull();
    expect(articleA.getAttribute('aria-pressed')).toBe('false');
    expect(container.textContent).toContain('选择一篇文章开始阅读');
    expect(storyCards.scrollTop).toBe(146);
    expect(container.querySelector('.sidebar-feed')?.classList.contains('is-active')).toBe(true);
    expect(container.querySelector('.story-list-header h1')?.textContent).toBe(feed.title);
    expect(
      container.querySelector('.story-list-filter')?.getAttribute('aria-label'),
    ).toBe('筛选文章');
    expect(listEntries).toHaveBeenCalledTimes(listRequestCount);

    act(() => articleA.click());
    expect(getContent).toHaveBeenCalledTimes(2);
    act(() => articleB.click());
    expect(articleA.classList.contains('is-active')).toBe(false);
    expect(articleB.classList.contains('is-active')).toBe(true);
    expect(container.textContent).not.toContain('选择一篇文章开始阅读');
    expect(container.querySelector('.entry-detail-title-row h2')?.textContent).toBe('文章 B');
    expect(storyCards.scrollTop).toBe(146);
    expect(listEntries).toHaveBeenCalledTimes(listRequestCount);
  });

  it('cycles list filters within the selected feed while sidebar filters stay global', async () => {
    await act(async () => {
      root.render(createElement(App));
      await Promise.resolve();
    });
    await flushAsyncState();

    const listFilterButton =
      container.querySelector<HTMLButtonElement>('.story-list-filter');
    expect(listFilterButton).not.toBeNull();

    act(() => listFilterButton?.click());
    await flushAsyncState();

    expect(listEntries).toHaveBeenLastCalledWith({
      isRead: false,
      limit: 30,
    });
    expect(container.querySelector('.story-list-header h1')?.textContent).toBe('未读文章');

    const feedButtons = container.querySelectorAll<HTMLButtonElement>('.sidebar-feed');
    const feedButton = feedButtons[0];
    const secondaryFeedButton = feedButtons[1];
    expect(feedButton).not.toBeUndefined();
    expect(secondaryFeedButton).not.toBeUndefined();
    act(() => feedButton?.click());
    await flushAsyncState();
    expect(container.querySelector('.story-list-header h1')?.textContent).toBe(feed.title);

    act(() => listFilterButton?.click());
    await flushAsyncState();

    expect(listEntries).toHaveBeenLastCalledWith({
      feedId: feed.id,
      isRead: false,
      limit: 30,
    });
    expect(feedButton?.classList.contains('is-active')).toBe(true);
    expect(container.querySelector('.story-list-header h1')?.textContent)
      .toBe('Daily Feed未读文章');
    const sidebarUnreadButton = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '.sidebar-navigation .sidebar-item',
      ),
    ].find((button) => button.textContent?.includes('未读'));
    expect(sidebarUnreadButton?.classList.contains('is-active')).toBe(false);

    act(() => listFilterButton?.click());
    await flushAsyncState();

    expect(listEntries).toHaveBeenLastCalledWith({
      feedId: feed.id,
      isStarred: true,
      limit: 30,
    });
    expect(feedButton?.classList.contains('is-active')).toBe(true);
    expect(container.querySelector('.story-list-header h1')?.textContent)
      .toBe('Daily Feed收藏文章');

    act(() => listFilterButton?.click());
    await flushAsyncState();

    expect(listEntries).toHaveBeenLastCalledWith({
      feedId: feed.id,
      limit: 30,
    });
    expect(container.querySelector('.story-list-header h1')?.textContent).toBe(feed.title);

    act(() => sidebarUnreadButton?.click());
    await flushAsyncState();

    expect(listEntries).toHaveBeenLastCalledWith({
      isRead: false,
      limit: 30,
    });
    expect(feedButton?.classList.contains('is-active')).toBe(false);
    expect(sidebarUnreadButton?.classList.contains('is-active')).toBe(true);
    expect(container.querySelector('.story-list-header h1')?.textContent).toBe('未读文章');

    const sidebarStarredButton = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '.sidebar-navigation .sidebar-item',
      ),
    ].find((button) => button.textContent?.includes('收藏'));
    act(() => sidebarStarredButton?.click());
    await flushAsyncState();

    expect(listEntries).toHaveBeenLastCalledWith({
      isStarred: true,
      limit: 30,
    });
    expect(container.querySelector('.story-list-header h1')?.textContent).toBe('收藏文章');

    act(() => secondaryFeedButton?.click());
    await flushAsyncState();

    expect(listEntries).toHaveBeenLastCalledWith({
      feedId: secondaryFeed.id,
      limit: 30,
    });
    expect(container.querySelector('.story-list-header h1')?.textContent)
      .toBe(secondaryFeed.title);

    act(() => listFilterButton?.click());
    await flushAsyncState();

    expect(listEntries).toHaveBeenLastCalledWith({
      feedId: secondaryFeed.id,
      isRead: false,
      limit: 30,
    });
    expect(container.querySelector('.story-list-header h1')?.textContent)
      .toBe('Engineering Notes未读文章');
    expect(container.querySelector('.story-list-state h2')?.textContent).toBe('没有未读文章');

    const allArticlesButton = container.querySelector<HTMLButtonElement>('.sidebar-all');
    act(() => allArticlesButton?.click());
    await flushAsyncState();

    expect(listEntries).toHaveBeenLastCalledWith({ limit: 30 });
    expect(container.querySelector('.story-list-header h1')?.textContent).toBe('全部文章');
  });

  it('offers a manual refresh that bypasses cached article content', async () => {
    getContent.mockResolvedValue({
      ok: true,
      data: {
        entryId: entries[0].id,
        sourceUrl: entries[0].url,
        cleanedHtml: '<p>Cached live report</p>',
        markdown: 'Cached live report',
        pipelineStatus: 'success',
      },
    });
    fetchAndClean.mockResolvedValue({
      ok: true,
      data: {
        entryId: entries[0].id,
        sourceUrl: entries[0].url,
        cleanedHtml: '<p>New live report update</p>',
        markdown: 'New live report update',
        pipelineStatus: 'success',
      },
    });

    await act(async () => {
      root.render(createElement(App));
      await Promise.resolve();
    });
    await flushAsyncState();

    act(() => container.querySelector<HTMLButtonElement>('.sidebar-feed')?.click());
    await flushAsyncState();
    act(() => findStoryCard(container, entries[0].title ?? '')?.click());
    await flushAsyncState();
    await flushAsyncState();

    expect(getContent).toHaveBeenCalledWith(entries[0].id);
    expect(fetchAndClean).not.toHaveBeenCalled();

    const refreshButton =
      container.querySelector<HTMLButtonElement>('.article-refresh-button');
    expect(refreshButton?.getAttribute('aria-label')).toBe('文章同步操作');
    expect(
      refreshButton?.closest('.article-action-tooltip')?.getAttribute('data-tooltip'),
    ).toBe('文章同步操作');
    expect(refreshButton?.hasAttribute('title')).toBe(false);
    expect(refreshButton?.textContent?.trim()).toBe('');
    expect(container.querySelector('[aria-label="更多文章操作"]')).toBeNull();
    expect(container.textContent).not.toContain('阅读设置');

    const focusButton =
      container.querySelector<HTMLButtonElement>('.reader-focus-toggle');
    expect(
      focusButton?.closest('.article-action-tooltip')?.getAttribute('data-tooltip'),
    ).toBe('进入专注阅读');
    const themeButton = container.querySelector<HTMLButtonElement>('.theme-toggle');
    expect(
      themeButton?.closest('.theme-toggle-tooltip')?.getAttribute('data-tooltip'),
    ).toBe('切换到白天模式');
    expect(themeButton?.hasAttribute('title')).toBe(false);
    const exportButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="导出为 Markdown"]',
    );
    expect(
      exportButton?.closest('.article-action-tooltip')?.getAttribute('data-tooltip'),
    ).toBe('导出为 Markdown');
    expect(exportButton?.hasAttribute('title')).toBe(false);

    act(() => refreshButton?.click());
    const refreshMenuItem = Array.from(container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    )).find((item) => item.textContent === '重新拉取文章');
    expect(refreshMenuItem).not.toBeUndefined();
    act(() => refreshMenuItem?.click());
    await flushAsyncState();

    expect(fetchAndClean).toHaveBeenCalledWith(entries[0].id);
    expect(getContent).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('正文已更新。');
  });

  it('turns the standalone copy-link button into a temporary success check', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    await act(async () => {
      root.render(createElement(App));
      await Promise.resolve();
    });
    await flushAsyncState();

    act(() => container.querySelector<HTMLButtonElement>('.sidebar-feed')?.click());
    await flushAsyncState();
    act(() => findStoryCard(container, entries[0].title ?? '')?.click());
    await flushAsyncState();

    const copyButton =
      container.querySelector<HTMLButtonElement>('.article-copy-button');
    expect(copyButton?.getAttribute('aria-label')).toBe('复制原文链接');
    expect(
      copyButton?.closest('.article-action-tooltip')?.getAttribute('data-tooltip'),
    ).toBe('复制原文链接');
    expect(copyButton?.hasAttribute('title')).toBe(false);
    expect(copyButton?.textContent?.trim()).toBe('');

    await act(async () => {
      copyButton?.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(entries[0].url);
    expect(copyButton?.classList.contains('is-copied')).toBe(true);
    expect(copyButton?.getAttribute('aria-label')).toBe('原文链接已复制');
    expect(
      copyButton?.closest('.article-action-tooltip')?.getAttribute('data-tooltip'),
    ).toBe('原文链接已复制');
    expect(copyButton?.disabled).toBe(true);
    expect(copyButton?.querySelector('.article-copy-button-success')).not.toBeNull();

    act(() => vi.advanceTimersByTime(2800));

    expect(copyButton?.classList.contains('is-copied')).toBe(false);
    expect(copyButton?.getAttribute('aria-label')).toBe('复制原文链接');
    expect(copyButton?.disabled).toBe(false);
  });
});
