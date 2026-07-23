// @vitest-environment jsdom

import {
  act,
  createElement,
  Fragment,
  forwardRef,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CleanedContent } from '../../../src/shared/contracts/content.types';
import type { Entry } from '../../../src/shared/contracts/feed.types';
import { DEFAULT_AI_PREFERENCES } from '../../../src/renderer/features/settings/aiPreferences';

vi.mock('../../../src/renderer/features/summary/SummaryPanel', () => ({
  SummaryPanel: forwardRef((_props, _ref) => null),
}));

vi.mock('../../../src/renderer/features/translation/TranslationPanel', () => ({
  TranslationPanel: forwardRef<unknown, { children?: ReactNode }>(
    ({ children }, _ref) => createElement(Fragment, null, children),
  ),
}));

vi.mock('../../../src/renderer/features/translation/InlineTranslationOverlay', () => ({
  InlineTranslationOverlay: () => null,
}));

import { EntryDetail } from '../../../src/renderer/features/feeds/EntryDetail';

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const entry: Entry = {
  id: 1,
  feedId: 1,
  title: 'Half-read article',
  createdAt: '2026-07-24T00:00:00.000Z',
  updatedAt: '2026-07-24T00:00:00.000Z',
  isRead: false,
  readingProgress: 0.5,
  isStarred: false,
  isDeleted: false,
};

const cleanedContent: CleanedContent = {
  entryId: entry.id,
  sourceUrl: 'https://example.com/article',
  cleanedHtml: '<p>Article content</p>',
  markdown: 'Article content',
  pipelineStatus: 'success',
};

const otherEntry: Entry = {
  ...entry,
  id: 2,
  title: 'Other article',
  readingProgress: 0.25,
};

describe('EntryDetail reading-progress restoration', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        content: {
          get: vi.fn().mockResolvedValue({ ok: true, data: cleanedContent }),
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

  it('preserves saved progress when switching away and back during layout restoration', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function height(
      this: HTMLElement,
    ) {
      return this.classList.contains('entry-detail-scroll') ? 1500 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function height(
      this: HTMLElement,
    ) {
      return this.classList.contains('entry-detail-scroll') ? 500 : 0;
    });
    const onReadingProgressChange = vi.fn().mockResolvedValue(undefined);
    const renderEntry = async (selectedEntry: Entry): Promise<void> => {
      await act(async () => {
        root.render(createElement(EntryDetail, {
          entry: selectedEntry,
          feedLoadStatus: 'success',
          feedLoadError: '',
          feedCount: 1,
          entryLoadStatus: 'success',
          entryLoadError: '',
          entryCount: 2,
          onAddFeed: vi.fn(),
          onRetryFeeds: vi.fn(),
          onRetryEntries: vi.fn(),
          aiPreferences: DEFAULT_AI_PREFERENCES,
          aiToolbarTarget: null,
          onReadingProgressChange,
        }));
        await Promise.resolve();
      });
    };

    await renderEntry(entry);
    expect(container.querySelector<HTMLDivElement>('.entry-detail-scroll')?.scrollTop).toBe(500);
    await renderEntry(otherEntry);
    expect(container.querySelector<HTMLDivElement>('.entry-detail-scroll')?.scrollTop).toBe(250);
    await renderEntry(entry);
    expect(container.querySelector<HTMLDivElement>('.entry-detail-scroll')?.scrollTop).toBe(500);

    expect(onReadingProgressChange).not.toHaveBeenCalled();
  });

  it('restores and resumes saving when content loads before the article pane mounts', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function height(
      this: HTMLElement,
    ) {
      return this.classList.contains('entry-detail-scroll') ? 1500 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function height(
      this: HTMLElement,
    ) {
      return this.classList.contains('entry-detail-scroll') ? 500 : 0;
    });
    const onReadingProgressChange = vi.fn().mockResolvedValue(undefined);
    const renderWithLoadStatus = async (
      entryLoadStatus: 'loading' | 'success',
    ): Promise<void> => {
      await act(async () => {
        root.render(createElement(EntryDetail, {
          entry,
          feedLoadStatus: 'success',
          feedLoadError: '',
          feedCount: 1,
          entryLoadStatus,
          entryLoadError: '',
          entryCount: 1,
          onAddFeed: vi.fn(),
          onRetryFeeds: vi.fn(),
          onRetryEntries: vi.fn(),
          aiPreferences: DEFAULT_AI_PREFERENCES,
          aiToolbarTarget: null,
          onReadingProgressChange,
        }));
        await Promise.resolve();
      });
    };

    await renderWithLoadStatus('loading');
    expect(container.querySelector('.entry-detail-scroll')).toBeNull();

    await renderWithLoadStatus('success');
    const scrollContainer = container.querySelector<HTMLDivElement>('.entry-detail-scroll');
    expect(scrollContainer?.scrollTop).toBe(500);

    vi.useFakeTimers();
    act(() => {
      if (!scrollContainer) return;
      scrollContainer.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      scrollContainer.scrollTop = 750;
      scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    vi.useRealTimers();

    expect(onReadingProgressChange).toHaveBeenCalledWith(entry.id, 0.75);
  });

  it('reapplies saved progress when delayed content increases the scroll height', async () => {
    let scrollHeight = 500;
    const resizeCallbacks: Array<() => void> = [];
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function height(
      this: HTMLElement,
    ) {
      return this.classList.contains('entry-detail-scroll') ? scrollHeight : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function height(
      this: HTMLElement,
    ) {
      return this.classList.contains('entry-detail-scroll') ? 500 : 0;
    });
    vi.stubGlobal('ResizeObserver', class ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(() => callback([], this as unknown as ResizeObserver));
      }

      observe = vi.fn();

      disconnect = vi.fn();

      unobserve = vi.fn();
    });
    const onReadingProgressChange = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(createElement(EntryDetail, {
        entry,
        feedLoadStatus: 'success',
        feedLoadError: '',
        feedCount: 1,
        entryLoadStatus: 'success',
        entryLoadError: '',
        entryCount: 1,
        onAddFeed: vi.fn(),
        onRetryFeeds: vi.fn(),
        onRetryEntries: vi.fn(),
        aiPreferences: DEFAULT_AI_PREFERENCES,
        aiToolbarTarget: null,
        onReadingProgressChange,
      }));
      await Promise.resolve();
    });

    const scrollContainer = container.querySelector<HTMLDivElement>('.entry-detail-scroll');
    expect(scrollContainer?.scrollTop).toBe(0);
    act(() => {
      scrollContainer?.dispatchEvent(new Event('scroll', { bubbles: true }));
      scrollContainer?.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(onReadingProgressChange).not.toHaveBeenCalled();

    scrollHeight = 1500;
    act(() => resizeCallbacks.forEach((notifyResize) => notifyResize()));

    expect(scrollContainer?.scrollTop).toBe(500);
  });
});
