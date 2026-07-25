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
  ],
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
    listEntries = vi.fn(async () => ({
      ok: true,
      data: {
        entries,
        nextCursor: undefined,
      },
    }));
    getContent = vi.fn(() => new Promise(() => undefined));
    unsubscribeSyncProgress = vi.fn();
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        feed: {
          list: vi.fn(async () => ({ ok: true, data: [feed] })),
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
          fetchAndClean: vi.fn(),
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
    ).toContain('当前为 all');
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
});
