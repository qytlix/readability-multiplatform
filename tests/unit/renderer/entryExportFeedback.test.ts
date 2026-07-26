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
import { EntryDetail } from '../../../src/renderer/features/feeds/EntryDetail';
import { DEFAULT_AI_PREFERENCES } from '../../../src/renderer/features/settings/aiPreferences';
import type { Entry } from '../../../src/shared/contracts/feed.types';

vi.mock('../../../src/renderer/features/summary/SummaryPanel', () => ({
  SummaryPanel: forwardRef((props, ref) => {
    void props;
    void ref;
    return null;
  }),
}));

vi.mock('../../../src/renderer/features/translation/TranslationPanel', () => ({
  TranslationPanel: forwardRef<unknown, { children?: ReactNode }>(
    ({ children }, ref) => {
      void ref;
      return createElement(Fragment, null, children);
    },
  ),
}));

vi.mock('../../../src/renderer/features/translation/InlineTranslationOverlay', () => ({
  InlineTranslationOverlay: () => null,
}));

vi.mock('../../../src/renderer/features/annotations/AnnotatedArticle', () => ({
  AnnotatedArticle: ({ sourceHtml }: { sourceHtml: string }) =>
    createElement('div', { dangerouslySetInnerHTML: { __html: sourceHtml } }),
}));

const entry: Entry = {
  id: 71,
  feedId: 3,
  title: 'Export feedback article',
  url: 'https://example.com/export-feedback',
  createdAt: '2026-07-26T00:00:00.000Z',
  updatedAt: '2026-07-26T00:00:00.000Z',
  isRead: false,
  readingProgress: 0,
  isStarred: false,
  isDeleted: false,
};

describe('single article export feedback', () => {
  let page: HTMLDivElement;
  let mount: HTMLDivElement;
  let exportToolbar: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    page = document.createElement('div');
    page.className = 'reader-page';
    mount = document.createElement('div');
    exportToolbar = document.createElement('div');
    page.append(mount, exportToolbar);
    document.body.append(page);
    root = createRoot(mount);
  });

  afterEach(() => {
    act(() => root.unmount());
    page.remove();
    vi.restoreAllMocks();
  });

  it('reports a successful Markdown export to the page feedback owner', async () => {
    const onFeedback = vi.fn();
    const exportSingle = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        filePath: 'C:\\Exports\\article.md',
        downloadedImageCount: 0,
        failedImageCount: 0,
      },
    });
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        content: {
          get: vi.fn().mockResolvedValue({
            ok: true,
            data: {
              entryId: entry.id,
              sourceUrl: entry.url,
              cleanedHtml: '<p>Exported body.</p>',
              markdown: 'Exported body.',
              pipelineStatus: 'success',
            },
          }),
        },
        annotation: {
          list: vi.fn().mockResolvedValue({ ok: true, data: [] }),
        },
        export: {
          checkAvailability: vi.fn().mockResolvedValue({
            ok: true,
            data: {
              articles: [{
                entryId: entry.id,
                title: entry.title,
                pipelineStatus: 'success',
                hasSummary: false,
                hasTranslation: false,
                hasNotes: false,
              }],
              unwashedIds: [],
            },
          }),
          single: exportSingle,
        },
      } as unknown as typeof window.shaleAPI,
    });

    await act(async () => {
      root.render(createElement(EntryDetail, {
        entry,
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
        exportToolbarTarget: exportToolbar,
        onAIViewStateChange: vi.fn(),
        onReadingProgressChange: vi.fn().mockResolvedValue(undefined),
        onFeedback,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const exportButton = page.querySelector<HTMLButtonElement>(
      '[aria-label="导出为 Markdown"]',
    );
    await act(async () => {
      exportButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const nextButton = [...page.querySelectorAll<HTMLButtonElement>(
      '.export-options-dialog .dialog-actions button',
    )].find((button) => button.textContent === '下一步');
    await act(async () => {
      nextButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(exportSingle).toHaveBeenCalledWith(entry.id, {
      includeSummary: false,
      includeTranslation: false,
      includeNotes: false,
    });
    expect(onFeedback).toHaveBeenCalledWith('Markdown 文档已成功导出。');
  });
});
