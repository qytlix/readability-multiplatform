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
  SummaryPanel: forwardRef(() => null),
}));

vi.mock('../../../src/renderer/features/translation/TranslationPanel', () => ({
  TranslationPanel: forwardRef<unknown, { children?: ReactNode }>(
    ({ children }) => createElement(Fragment, null, children),
  ),
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
});
