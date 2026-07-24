// @vitest-environment jsdom

import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import type { Feed } from '../../../src/shared/contracts/feed.types';
import { FeedList } from '../../../src/renderer/features/feeds/FeedList';

type FeedListProps = Parameters<typeof FeedList>[0];

const feeds: Feed[] = [
  {
    id: 1,
    title: 'TechCrunch',
    feedURL: 'https://example.com/tech.xml',
    lastSyncStatus: 'success',
    syncIntervalMin: 30,
    createdAt: '2026-07-24T00:00:00.000Z',
  },
  {
    id: 2,
    title: '少数派',
    feedURL: 'https://example.com/sspai.xml',
    lastSyncStatus: 'never',
    syncIntervalMin: 30,
    createdAt: '2026-07-24T00:00:00.000Z',
  },
];

const createFeedListProps = (
  overrides: Partial<FeedListProps> = {},
): FeedListProps => ({
  feeds,
  selectedFeedId: null,
  selectedFilter: 'all',
  searchInput: '',
  searchStatus: 'idle',
  searchInputRef: createRef<HTMLInputElement>(),
  onSearchInputChange: vi.fn(),
  onSelectFilter: vi.fn(),
  onSelectFeed: vi.fn(),
  onRefresh: vi.fn(async () => true),
  onLocalRefresh: vi.fn(async () => undefined),
  onOpenAddFeed: vi.fn(),
  entryStats: {
    all: { total: 5, unread: 3, readPercentage: 40 },
    feeds: [
      { feedId: 1, total: 5, unread: 3, readPercentage: 40 },
    ],
  },
  loading: false,
  feedLoadStatus: 'success',
  settingsActive: false,
  onOpenSettings: vi.fn(),
  ...overrides,
});

describe('FeedList unread counts', () => {
  it('shows each feed unread count and defaults missing statistics to zero', () => {
    const markup = renderToStaticMarkup(
      createElement(FeedList, createFeedListProps()),
    );
    const document = new JSDOM(markup).window.document;
    const counts = [...document.querySelectorAll('.sidebar-feed-unread-count')]
      .map((count) => count.textContent);

    expect(counts).toEqual(['3', '0']);
  });

  it('rotates only the clicked feed sync icon until that request finishes', async () => {
    let completeSync = (): void => {
      throw new Error('Sync request was not initialized');
    };
    const syncRequest = new Promise((resolve) => {
      completeSync = () => resolve({ ok: true, data: [] });
    });
    const sync = vi.fn(() => syncRequest);
    const onLocalRefresh = vi.fn(async () => undefined);
    const unsubscribe = vi.fn();
    vi.stubGlobal('shaleAPI', {
      feed: {
        sync,
        onSyncProgress: vi.fn(() => unsubscribe),
      },
    } as unknown as typeof window.shaleAPI);

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(createElement(
          FeedList,
          createFeedListProps({ onLocalRefresh }),
        ));
      });

      const buttons = [...container.querySelectorAll<HTMLButtonElement>(
        '.sidebar-feed-actions .sync-button',
      )];
      expect(buttons).toHaveLength(2);

      await act(async () => {
        buttons[0].click();
      });

      expect(buttons[0].classList.contains('is-loading')).toBe(true);
      expect(buttons[0].disabled).toBe(true);
      expect(buttons[1].classList.contains('is-loading')).toBe(false);
      expect(sync).toHaveBeenCalledTimes(1);
      expect(sync).toHaveBeenCalledWith(1);

      await act(async () => {
        completeSync();
        await syncRequest;
      });

      expect(buttons[0].classList.contains('is-loading')).toBe(false);
      expect(buttons[0].disabled).toBe(false);
      expect(onLocalRefresh).toHaveBeenCalledTimes(1);
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
