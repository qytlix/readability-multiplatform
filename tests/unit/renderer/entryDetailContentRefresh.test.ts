// @vitest-environment jsdom

import {
  act,
  createElement,
  Fragment,
  forwardRef,
  StrictMode,
  useImperativeHandle,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CleanedContent } from '../../../src/shared/contracts/content.types';
import type { Entry } from '../../../src/shared/contracts/feed.types';
import { DEFAULT_AI_PREFERENCES } from '../../../src/renderer/features/settings/aiPreferences';

vi.mock('../../../src/renderer/features/summary/SummaryPanel', () => ({
  SummaryPanel: forwardRef(() => null),
}));

vi.mock('../../../src/renderer/features/translation/TranslationPanel', () => ({
  TranslationPanel: forwardRef<
    { requestRetranslation: () => Promise<'started'>; activate: () => void },
    { children?: ReactNode }
  >(({ children }, ref) => {
    useImperativeHandle(ref, () => ({
      requestRetranslation: () => Promise.resolve('started'),
      activate: () => undefined,
    }));
    return createElement(Fragment, null, children);
  }),
}));

vi.mock('../../../src/renderer/features/translation/InlineTranslationOverlay', () => ({
  InlineTranslationOverlay: () => null,
}));

vi.mock('../../../src/renderer/features/annotations/AnnotatedArticle', () => ({
  AnnotatedArticle: ({ sourceHtml }: { sourceHtml: string }) =>
    createElement('div', { dangerouslySetInnerHTML: { __html: sourceHtml } }),
}));

import { EntryDetail } from '../../../src/renderer/features/feeds/EntryDetail';

const entry: Entry = {
  id: 486,
  feedId: 8,
  title: 'Live report',
  url: 'https://example.com/live-report',
  createdAt: '2026-07-24T00:00:00.000Z',
  updatedAt: '2026-07-24T00:00:00.000Z',
  isRead: false,
  readingProgress: 0,
  isStarred: false,
  isDeleted: false,
};

const cachedContent: CleanedContent = {
  entryId: entry.id,
  sourceUrl: entry.url ?? '',
  cleanedHtml: '<article><h2>Earlier update</h2></article>',
  markdown: '## Earlier update',
  pipelineStatus: 'success',
  sourceContentHash: 'old-hash',
};

const refreshedContent: CleanedContent = {
  ...cachedContent,
  cleanedHtml: [
    '<article>',
    '<h2>Newest update</h2>',
    '<h2>Earlier update</h2>',
    '</article>',
  ].join(''),
  markdown: '## Newest update\n\n## Earlier update',
  sourceContentHash: 'new-hash',
};

describe('EntryDetail content refresh', () => {
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

  it('bypasses a successful cache when a refresh is requested', async () => {
    const getContent = vi.fn().mockResolvedValue({
      ok: true,
      data: cachedContent,
    });
    const fetchAndClean = vi.fn().mockResolvedValue({
      ok: true,
      data: refreshedContent,
    });
    const onContentRefreshComplete = vi.fn();
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        content: {
          get: getContent,
          fetchAndClean,
        },
        annotation: {
          list: vi.fn().mockResolvedValue({ ok: true, data: [] }),
        },
      } as unknown as typeof window.shaleAPI,
    });

    const render = async (contentRefreshVersion: number): Promise<void> => {
      await act(async () => {
        root.render(createElement(EntryDetail, {
          entry,
          contentRefreshVersion,
          aiViewState: { summaryVisible: false, translationVisible: false },
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
          onAIViewStateChange: vi.fn(),
          onReadingProgressChange: vi.fn().mockResolvedValue(undefined),
          onContentRefreshComplete,
        }));
        await Promise.resolve();
        await Promise.resolve();
      });
    };

    await render(0);
    expect(container.textContent).toContain('Earlier update');
    expect(container.textContent).not.toContain('Newest update');
    expect(getContent).toHaveBeenCalledTimes(1);
    expect(fetchAndClean).not.toHaveBeenCalled();

    await render(1);
    expect(fetchAndClean).toHaveBeenCalledTimes(1);
    expect(getContent).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Newest update');
    expect(container.textContent).toContain('Earlier update');
    expect(onContentRefreshComplete).toHaveBeenCalledWith(entry.id, {
      ok: true,
    });
  });

  it('refetches when the cached content is failed and empty', async () => {
    const failedContent: CleanedContent = {
      entryId: entry.id,
      sourceUrl: '',
      cleanedHtml: '',
      markdown: '',
      pipelineStatus: 'failed',
      pipelineError: 'Browser fetch failed: ERR_INVALID_URL',
    };
    const getContent = vi.fn().mockResolvedValue({
      ok: true,
      data: failedContent,
    });
    const fetchAndClean = vi.fn().mockResolvedValue({
      ok: true,
      data: refreshedContent,
    });
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        content: {
          get: getContent,
          fetchAndClean,
        },
        annotation: {
          list: vi.fn().mockResolvedValue({ ok: true, data: [] }),
        },
      } as unknown as typeof window.shaleAPI,
    });

    await act(async () => {
      root.render(createElement(EntryDetail, {
        entry,
        contentRefreshVersion: 0,
        aiViewState: { summaryVisible: false, translationVisible: false },
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
        onAIViewStateChange: vi.fn(),
        onReadingProgressChange: vi.fn().mockResolvedValue(undefined),
      }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getContent).toHaveBeenCalledWith(entry.id);
    expect(fetchAndClean).toHaveBeenCalledWith(entry.id);
    expect(container.textContent).toContain('Newest update');
    expect(container.textContent).not.toContain('ERR_INVALID_URL');
  });

  it('keeps a real cache miss loading until fetch and clean succeeds', async () => {
    let resolveFetch!: (value: { ok: true; data: CleanedContent }) => void;
    const pendingFetch = new Promise<{ ok: true; data: CleanedContent }>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchAndClean = vi.fn(() => pendingFetch);
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        content: {
          get: vi.fn().mockResolvedValue({ ok: true, data: null }),
          fetchAndClean,
        },
        annotation: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
      } as unknown as typeof window.shaleAPI,
    });

    await act(async () => {
      root.render(createElement(EntryDetail, {
        entry,
        contentRefreshVersion: 0,
        aiViewState: { summaryVisible: false, translationVisible: false },
        feedLoadStatus: 'success', feedLoadError: '', feedCount: 1,
        entryLoadStatus: 'success', entryLoadError: '', entryCount: 1,
        onAddFeed: vi.fn(), onRetryFeeds: vi.fn(), onRetryEntries: vi.fn(),
        aiPreferences: DEFAULT_AI_PREFERENCES, aiToolbarTarget: null,
        onAIViewStateChange: vi.fn(),
        onReadingProgressChange: vi.fn().mockResolvedValue(undefined),
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchAndClean).toHaveBeenCalledWith(entry.id);
    expect(container.textContent).toContain('Fetching and cleaning article content...');

    await act(async () => {
      resolveFetch({ ok: true, data: refreshedContent });
      await pendingFetch;
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Newest update');
    expect(container.textContent).not.toContain('Fetching and cleaning article content...');
  });

  it('shows a Feed preview while the full article loads in the background', async () => {
    const previewContent: CleanedContent = {
      ...cachedContent,
      isPreview: true,
      cleanedHtml: '<article><p>Immediate Feed preview</p></article>',
      markdown: 'Immediate Feed preview',
    };
    let resolveFetch!: (value: {
      ok: true;
      data: CleanedContent;
    }) => void;
    const pendingFetch = new Promise<{
      ok: true;
      data: CleanedContent;
    }>((resolve) => {
      resolveFetch = resolve;
    });
    const getContent = vi.fn().mockResolvedValue({
      ok: true,
      data: previewContent,
    });
    const fetchAndClean = vi.fn(() => pendingFetch);
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        content: {
          get: getContent,
          fetchAndClean,
        },
        annotation: {
          list: vi.fn().mockResolvedValue({ ok: true, data: [] }),
        },
      } as unknown as typeof window.shaleAPI,
    });

    await act(async () => {
      root.render(createElement(EntryDetail, {
        entry,
        contentRefreshVersion: 0,
        aiViewState: { summaryVisible: false, translationVisible: false },
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
        onAIViewStateChange: vi.fn(),
        onReadingProgressChange: vi.fn().mockResolvedValue(undefined),
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchAndClean).toHaveBeenCalledWith(entry.id);
    expect(container.textContent).toContain('Immediate Feed preview');
    expect(container.textContent).toContain('正在显示订阅摘要');

    await act(async () => {
      resolveFetch({ ok: true, data: refreshedContent });
      await pendingFetch;
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Newest update');
    expect(container.textContent).not.toContain('Immediate Feed preview');
    expect(container.textContent).not.toContain('正在显示订阅摘要');
  });

  it('waits for cached content restoration before consuming a retranslation request', async () => {
    let resolveGet!: (value: { ok: true; data: CleanedContent }) => void;
    const pendingGet = new Promise<{ ok: true; data: CleanedContent }>((resolve) => {
      resolveGet = resolve;
    });
    const onRetranslationRequestComplete = vi.fn();
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        content: { get: vi.fn(() => pendingGet), fetchAndClean: vi.fn() },
        annotation: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
      } as unknown as typeof window.shaleAPI,
    });

    await act(async () => {
      root.render(createElement(EntryDetail, {
        entry,
        contentRefreshVersion: 0,
        aiViewState: { summaryVisible: false, translationVisible: false },
        feedLoadStatus: 'success', feedLoadError: '', feedCount: 1,
        entryLoadStatus: 'success', entryLoadError: '', entryCount: 1,
        onAddFeed: vi.fn(), onRetryFeeds: vi.fn(), onRetryEntries: vi.fn(),
        aiPreferences: DEFAULT_AI_PREFERENCES, aiToolbarTarget: null,
        onAIViewStateChange: vi.fn(), onReadingProgressChange: vi.fn().mockResolvedValue(undefined),
        retranslationRequest: { entryId: entry.id, version: 4 },
        onRetranslationRequestComplete,
      }));
      await Promise.resolve();
    });
    expect(onRetranslationRequestComplete).not.toHaveBeenCalled();

    await act(async () => {
      resolveGet({ ok: true, data: cachedContent });
      await pendingGet;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Earlier update');
    expect(onRetranslationRequestComplete).toHaveBeenCalledWith(entry.id, 'started');
    expect(onRetranslationRequestComplete).not.toHaveBeenCalledWith(entry.id, 'content-unavailable');
  });

  it('ignores an older article response that completes after the current article', async () => {
    const nextEntry: Entry = { ...entry, id: entry.id + 1, title: 'Current article' };
    const nextContent: CleanedContent = {
      ...cachedContent,
      entryId: nextEntry.id,
      cleanedHtml: '<article><p>Current article body</p></article>',
      markdown: 'Current article body',
    };
    let resolveOldGet!: (value: { ok: true; data: CleanedContent }) => void;
    const oldGet = new Promise<{ ok: true; data: CleanedContent }>((resolve) => {
      resolveOldGet = resolve;
    });
    const get = vi.fn((entryId: number) => entryId === entry.id
      ? oldGet
      : Promise.resolve({ ok: true as const, data: nextContent }));
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        content: { get, fetchAndClean: vi.fn() },
        annotation: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
      } as unknown as typeof window.shaleAPI,
    });
    const renderEntry = async (selectedEntry: Entry): Promise<void> => {
      await act(async () => {
        root.render(createElement(EntryDetail, {
          entry: selectedEntry,
          contentRefreshVersion: 0,
          aiViewState: { summaryVisible: false, translationVisible: false },
          feedLoadStatus: 'success', feedLoadError: '', feedCount: 1,
          entryLoadStatus: 'success', entryLoadError: '', entryCount: 2,
          onAddFeed: vi.fn(), onRetryFeeds: vi.fn(), onRetryEntries: vi.fn(),
          aiPreferences: DEFAULT_AI_PREFERENCES, aiToolbarTarget: null,
          onAIViewStateChange: vi.fn(), onReadingProgressChange: vi.fn().mockResolvedValue(undefined),
        }));
        await Promise.resolve();
        await Promise.resolve();
      });
    };

    await renderEntry(entry);
    await renderEntry(nextEntry);
    expect(container.textContent).toContain('Current article body');
    await act(async () => {
      resolveOldGet({ ok: true, data: cachedContent });
      await oldGet;
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Current article body');
    expect(container.textContent).not.toContain('Earlier update');
  });

  it('restores persisted content after the Reader page is remounted', async () => {
    let resolveUnmountedGet!: (value: { ok: false; error: {
      code: string; message: string; retryable: boolean;
    } }) => void;
    const unmountedGet = new Promise<{ ok: false; error: {
      code: string; message: string; retryable: boolean;
    } }>((resolve) => {
      resolveUnmountedGet = resolve;
    });
    const get = vi.fn()
      .mockImplementationOnce(() => unmountedGet)
      .mockResolvedValueOnce({ ok: true, data: cachedContent });
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        content: { get, fetchAndClean: vi.fn() },
        annotation: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
      } as unknown as typeof window.shaleAPI,
    });
    const props = {
      entry,
      contentRefreshVersion: 0,
      aiViewState: { summaryVisible: false, translationVisible: false },
      feedLoadStatus: 'success' as const, feedLoadError: '', feedCount: 1,
      entryLoadStatus: 'success' as const, entryLoadError: '', entryCount: 1,
      onAddFeed: vi.fn(), onRetryFeeds: vi.fn(), onRetryEntries: vi.fn(),
      aiPreferences: DEFAULT_AI_PREFERENCES, aiToolbarTarget: null,
      onAIViewStateChange: vi.fn(), onReadingProgressChange: vi.fn().mockResolvedValue(undefined),
    };

    await act(async () => {
      root.render(createElement(EntryDetail, props));
      await Promise.resolve();
    });
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(EntryDetail, props));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Earlier update');

    await act(async () => {
      resolveUnmountedGet({
        ok: false,
        error: { code: 'CONTENT_GET_FAILED', message: 'Old request failed', retryable: true },
      });
      await unmountedGet;
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Earlier update');
    expect(container.textContent).not.toContain('Old request failed');
  });

  it('restarts cached content restoration when mount effects are replayed for the same entry', async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, data: cachedContent });
    const fetchAndClean = vi.fn();
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        content: { get, fetchAndClean },
        annotation: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
      } as unknown as typeof window.shaleAPI,
    });

    await act(async () => {
      root.render(createElement(
        StrictMode,
        null,
        createElement(EntryDetail, {
          entry,
          contentRefreshVersion: 0,
          aiViewState: { summaryVisible: false, translationVisible: false },
          feedLoadStatus: 'success', feedLoadError: '', feedCount: 1,
          entryLoadStatus: 'success', entryLoadError: '', entryCount: 1,
          onAddFeed: vi.fn(), onRetryFeeds: vi.fn(), onRetryEntries: vi.fn(),
          aiPreferences: DEFAULT_AI_PREFERENCES, aiToolbarTarget: null,
          onAIViewStateChange: vi.fn(),
          onReadingProgressChange: vi.fn().mockResolvedValue(undefined),
        }),
      ));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(get).toHaveBeenCalledTimes(2);
    expect(fetchAndClean).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Earlier update');
    expect(container.textContent).not.toContain('Fetching and cleaning article content...');
  });

  it('reports content unavailable only after content restoration finally fails', async () => {
    const onRetranslationRequestComplete = vi.fn();
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        content: {
          get: vi.fn().mockResolvedValue({ ok: true, data: null }),
          fetchAndClean: vi.fn().mockResolvedValue({
            ok: false,
            error: { code: 'CONTENT_FETCH_FAILED', message: 'Network failed', retryable: true },
          }),
        },
        annotation: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
      } as unknown as typeof window.shaleAPI,
    });
    await act(async () => {
      root.render(createElement(EntryDetail, {
        entry,
        contentRefreshVersion: 0,
        aiViewState: { summaryVisible: false, translationVisible: false },
        feedLoadStatus: 'success', feedLoadError: '', feedCount: 1,
        entryLoadStatus: 'success', entryLoadError: '', entryCount: 1,
        onAddFeed: vi.fn(), onRetryFeeds: vi.fn(), onRetryEntries: vi.fn(),
        aiPreferences: DEFAULT_AI_PREFERENCES, aiToolbarTarget: null,
        onAIViewStateChange: vi.fn(), onReadingProgressChange: vi.fn().mockResolvedValue(undefined),
        retranslationRequest: { entryId: entry.id, version: 5 },
        onRetranslationRequestComplete,
      }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Network failed');
    expect(onRetranslationRequestComplete).toHaveBeenCalledTimes(1);
    expect(onRetranslationRequestComplete).toHaveBeenCalledWith(entry.id, 'content-unavailable');
  });
});
