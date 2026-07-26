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
    expect(filterButton?.getAttribute('title')).toBe(entryListCopy.filterArticles);

    await act(async () => filterButton?.focus());
    expect(document.activeElement).toBe(filterButton);

    await act(async () => filterButton?.click());
    expect(onFilterChange).toHaveBeenCalledWith('unread');
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
