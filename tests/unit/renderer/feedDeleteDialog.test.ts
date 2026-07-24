// @vitest-environment jsdom

import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Feed } from '../../../src/shared/contracts/feed.types';
import { FeedList } from '../../../src/renderer/features/feeds/FeedList';

type FeedListProps = Parameters<typeof FeedList>[0];

const feed: Feed = {
  id: 7,
  title: '少数派',
  feedURL: 'https://example.com/sspai.xml',
  lastSyncStatus: 'success',
  syncIntervalMin: 30,
  createdAt: '2026-07-24T00:00:00.000Z',
};

const createFeedListProps = (
  overrides: Partial<FeedListProps> = {},
): FeedListProps => ({
  feeds: [feed],
  selectedFeedId: feed.id,
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
    all: { total: 3, unread: 2, readPercentage: 33 },
    feeds: [
      { feedId: feed.id, total: 3, unread: 2, readPercentage: 33 },
    ],
  },
  loading: false,
  feedLoadStatus: 'success',
  settingsActive: false,
  onOpenSettings: vi.fn(),
  ...overrides,
});

const findButton = (
  container: ParentNode,
  label: string,
): HTMLButtonElement | undefined => (
  [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === label)
);

describe('feed delete confirmation dialog', () => {
  let root: Root;
  let page: HTMLDivElement;
  let remove: ReturnType<typeof vi.fn>;
  let unsubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    page = document.createElement('div');
    page.className = 'reader-page';
    document.body.append(page);
    root = createRoot(page);
    remove = vi.fn(async () => ({ ok: true, data: undefined }));
    unsubscribe = vi.fn();
    vi.stubGlobal('shaleAPI', {
      feed: {
        remove,
        sync: vi.fn(),
        onSyncProgress: vi.fn(() => unsubscribe),
      },
    } as unknown as typeof window.shaleAPI);
  });

  afterEach(() => {
    act(() => root.unmount());
    page.remove();
    vi.unstubAllGlobals();
  });

  it('opens an in-app alert dialog with the selected feed and deletion scope', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm');

    await act(async () => {
      root.render(createElement(FeedList, createFeedListProps()));
    });

    const removeButton = page.querySelector<HTMLButtonElement>(
      'button[aria-label="移除 少数派"]',
    );
    expect(removeButton).not.toBeNull();

    act(() => removeButton?.click());

    const dialog = page.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.textContent).toContain('少数派');
    expect(dialog?.textContent).toContain(feed.feedURL);
    expect(dialog?.textContent).toContain('文章、收藏和阅读进度');
    expect(dialog?.textContent).toContain('此操作无法撤销');
    expect(dialog?.querySelector('.feed-delete-icon')).toBeNull();
    expect(dialog?.querySelector('.feed-delete-eyebrow')).toBeNull();
    expect(document.activeElement?.textContent).toBe('取消');
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it('keeps deletion behind the explicit destructive action', async () => {
    const onLocalRefresh = vi.fn(async () => undefined);
    const onSelectFeed = vi.fn();

    await act(async () => {
      root.render(createElement(
        FeedList,
        createFeedListProps({ onLocalRefresh, onSelectFeed }),
      ));
    });

    act(() => {
      page.querySelector<HTMLButtonElement>(
        'button[aria-label="移除 少数派"]',
      )?.click();
    });

    const cancelButton = findButton(page, '取消');
    expect(cancelButton).toBeDefined();
    act(() => cancelButton?.click());
    expect(page.querySelector('[role="alertdialog"]')).toBeNull();
    expect(remove).not.toHaveBeenCalled();

    act(() => {
      page.querySelector<HTMLButtonElement>(
        'button[aria-label="移除 少数派"]',
      )?.click();
    });

    await act(async () => {
      findButton(page, '删除订阅源')?.click();
    });

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(feed.id);
    expect(onSelectFeed).toHaveBeenCalledWith(null);
    expect(onLocalRefresh).toHaveBeenCalledTimes(1);
    expect(page.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('stays open and shows the service error when deletion fails', async () => {
    remove.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'FEED_REMOVE_FAILED',
        message: '无法删除这个订阅源',
        retryable: true,
      },
    });

    await act(async () => {
      root.render(createElement(FeedList, createFeedListProps()));
    });
    act(() => {
      page.querySelector<HTMLButtonElement>(
        'button[aria-label="移除 少数派"]',
      )?.click();
    });

    await act(async () => {
      findButton(page, '删除订阅源')?.click();
    });

    expect(page.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(page.querySelector('[role="alert"]')?.textContent)
      .toBe('无法删除这个订阅源');
    expect(findButton(page, '删除订阅源')?.disabled).toBe(false);
  });

  it('allows the safe escape route from the keyboard', async () => {
    await act(async () => {
      root.render(createElement(FeedList, createFeedListProps()));
    });
    act(() => {
      page.querySelector<HTMLButtonElement>(
        'button[aria-label="移除 少数派"]',
      )?.click();
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(page.querySelector('[role="alertdialog"]')).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });
});
