// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntryList } from '../../../src/renderer/features/feeds/EntryList';
import { entryListCopy } from '../../../src/renderer/features/feeds/entryListPresentation';

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

  it('keeps header actions present when an empty result has a long feed heading', async () => {
    const longFeedName = 'A very long Feed name that must truncate before it covers the header actions';
    await render({
      entries: [],
      heading: `${longFeedName} · 未读文章`,
    });

    const heading = container.querySelector<HTMLHeadingElement>('.story-list-heading h1');
    expect(heading?.textContent).toBe(`${longFeedName} · 未读文章`);
    expect(heading?.getAttribute('title')).toBe(`${longFeedName} · 未读文章`);
    expect(container.querySelectorAll('.story-list-header-actions button')).toHaveLength(2);
    expect(container.querySelector('.story-list-heading')).not.toBeNull();
  });

  it('renders plain-text search snippets and safe match elements', async () => {
    await render({
      entries: [{
        id: 1,
        feedId: 1,
        title: '<script>Database title</script>',
        createdAt: '2026-07-27T00:00:00.000Z',
        isRead: false,
        readingProgress: 0,
        isStarred: false,
        pipelineStatus: 'success',
        searchSnippet: 'A database body with <img src=x> text.',
      }],
      searchQuery: 'database',
      searchStatus: 'results',
    });

    expect(container.querySelectorAll('.entry-search-match')).toHaveLength(2);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<script>');
    expect(container.textContent).toContain('<img src=x>');
  });

  async function render(overrides: Partial<Parameters<typeof EntryList>[0]> = {}): Promise<void> {
    await act(async () => {
      root.render(createElement(EntryList, {
        entries: [],
        selectedEntryId: null,
        heading: '全部文章',
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
