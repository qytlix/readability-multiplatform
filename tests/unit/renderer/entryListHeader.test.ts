// @vitest-environment jsdom

import fs from 'node:fs';
import path from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntryList } from '../../../src/renderer/features/feeds/EntryList';
import {
  entryListCopy,
  getEntryListHeadingPresentation,
} from '../../../src/renderer/features/feeds/entryListPresentation';

describe('EntryList header', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('provides the shared tooltip and accessible name for the article filter', async () => {
    const onFilterChange = vi.fn();
    await render({ onFilterChange });

    const tooltip = container.querySelector<HTMLElement>('.story-list-filter-tooltip');
    const filterButton = container.querySelector<HTMLButtonElement>('.story-list-filter');
    expect(tooltip?.getAttribute('data-tooltip')).toBe(entryListCopy.filterArticles);
    expect(filterButton?.getAttribute('aria-label')).toBe(entryListCopy.filterArticles);
    expect(filterButton?.hasAttribute('title')).toBe(false);

    await act(async () => filterButton?.focus());
    expect(document.activeElement).toBe(filterButton);

    await act(async () => filterButton?.click());
    expect(onFilterChange).toHaveBeenCalledWith('unread');
  });

  it('uses the shared tooltip for article selection mode', async () => {
    const onSelectionModeChange = vi.fn();
    await render({ onSelectionModeChange });

    const button = container.querySelector<HTMLButtonElement>('.story-list-select');
    const tooltip = button?.closest<HTMLElement>('.story-list-select-tooltip');
    expect(tooltip?.getAttribute('data-tooltip')).toBe('选择文章');
    expect(button?.getAttribute('aria-label')).toBe('选择文章');
    expect(button?.hasAttribute('title')).toBe(false);

    await act(async () => button?.click());
    expect(onSelectionModeChange).toHaveBeenCalledWith(true);
  });

  it('separates a long feed name from its visible filter suffix without a separator', async () => {
    const longFeedName = 'A very long Feed name that must truncate before it covers the header actions';
    await render({
      entries: [],
      heading: getEntryListHeadingPresentation({
        feedName: longFeedName,
        filter: 'unread',
        hasActiveSearch: false,
      }),
    });

    const heading = container.querySelector<HTMLHeadingElement>('.story-list-heading h1');
    const feedName = container.querySelector<HTMLElement>('.story-list-heading-feed-name');
    const suffix = container.querySelector<HTMLElement>('.story-list-heading-filter-suffix');
    expect(heading?.textContent).not.toContain('·');
    expect(heading?.getAttribute('title')).toBe(`${longFeedName} 未读文章`);
    expect(heading?.getAttribute('aria-label')).toBe(`${longFeedName} 未读文章`);
    expect(feedName?.textContent).toBe(longFeedName);
    expect(suffix?.textContent).toBe(entryListCopy.unreadArticles);
    expect(container.querySelector('.story-list-heading-filter-separator')).toBeNull();
    expect(container.querySelectorAll('.story-list-header-actions button')).toHaveLength(2);
  });

  it('keeps global filter headings at the primary heading level', async () => {
    await render({
      heading: getEntryListHeadingPresentation({
        feedName: null,
        filter: 'starred',
        hasActiveSearch: false,
      }),
    });

    expect(container.querySelector('.story-list-heading-primary')?.textContent)
      .toBe(entryListCopy.starredArticles);
    expect(container.querySelector('.story-list-heading-filter-suffix')).toBeNull();
  });

  it('renders a selected feed all-articles heading without a filter suffix', async () => {
    await render({
      heading: getEntryListHeadingPresentation({
        feedName: 'Daily Feed',
        filter: 'all',
        hasActiveSearch: false,
      }),
    });

    expect(container.querySelector('.story-list-heading-feed-name')?.textContent)
      .toBe('Daily Feed');
    expect(container.querySelector('.story-list-heading-filter-suffix')).toBeNull();
  });

  it('uses flex overflow rules so a feed name takes the space before fixed actions', () => {
    const css = fs.readFileSync(path.resolve(
      __dirname,
      '../../../src/renderer/features/reader/ReaderPage.css',
    ), 'utf8');

    expect(css).toContain('.story-list-heading {\n  flex: 1 1 0;\n  min-width: 0;');
    expect(css).toContain('.story-list-heading-feed-name {\n  flex: 1 1 auto;');
    expect(css).toContain(
      '.story-list-header-actions {\n  display: flex;\n  flex: 0 0 auto;\n  align-items: center;\n  gap: 4px;\n  margin-left: 12px;\n  margin-bottom: -6px;',
    );
    expect(css).toContain('.story-list-filter {\n  margin-bottom: 0;');
    expect(css).toContain('text-overflow: ellipsis;');
    expect(css).toContain('font-size: 0.8em;');
    expect(css).not.toMatch(/\.story-list-header h1\s*\{[^}]*max-width:/s);
  });

  async function render(overrides: Partial<Parameters<typeof EntryList>[0]> = {}): Promise<void> {
    await act(async () => {
      root.render(createElement(EntryList, {
        entries: [],
        selectedEntryId: null,
        heading: getEntryListHeadingPresentation({
          feedName: null,
          filter: 'all',
          hasActiveSearch: false,
        }),
        loading: false,
        loadStatus: 'success',
        loadError: '',
        searchQuery: '',
        searchStatus: 'idle',
        filter: 'all',
        onFilterChange: vi.fn(),
        onSelectEntry: vi.fn(),
        onLoadMore: vi.fn(),
        hasMore: false,
        ...overrides,
      }));
    });
  }
});
