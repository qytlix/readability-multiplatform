// @vitest-environment jsdom

import {
  act,
  createElement,
  forwardRef,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CleanedContent } from '../../../src/shared/contracts/content.types';
import type { Entry } from '../../../src/shared/contracts/feed.types';
import type { TranslationResult } from '../../../src/shared/contracts/translation.types';
import { DEFAULT_AI_PREFERENCES } from '../../../src/renderer/features/settings/aiPreferences';

vi.mock('../../../src/renderer/features/summary/SummaryPanel', () => ({
  SummaryPanel: forwardRef(() => null),
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
  title: 'Source article',
  createdAt: '2026-07-25T00:00:00.000Z',
  updatedAt: '2026-07-25T00:00:00.000Z',
  isRead: false,
  readingProgress: 0,
  isStarred: false,
  isDeleted: false,
};

const content: CleanedContent = {
  entryId: entry.id,
  sourceUrl: 'https://example.com/article',
  cleanedHtml: '<p>Source paragraph.</p>',
  markdown: 'Source paragraph.',
  pipelineStatus: 'success',
};

const translatedResult: TranslationResult = {
  id: 8,
  entryId: entry.id,
  targetLanguage: 'zh-CN',
  sourceContentHash: 'content-hash',
  segmenterVersion: 'v3',
  terminologyPackVersion: 'none',
  promptVersion: 'translation-v1',
  status: 'succeeded',
  createdAt: '2026-07-25T00:00:00.000Z',
  updatedAt: '2026-07-25T00:00:00.000Z',
  segments: [
    {
      sourceSegmentId: 'paragraph-1',
      orderIndex: 0,
      sourceType: 'paragraph',
      sourceHtml: '<p>Source paragraph.</p>',
      sourceText: 'Source paragraph.',
      translatedHtml: '<p>译文段落。</p>',
      translatedText: '译文段落。',
      terminologyMatches: [],
      status: 'succeeded',
    },
  ],
};

describe('Translation toolbar continuity', () => {
  let container: HTMLDivElement;
  let toolbarTarget: HTMLDivElement;
  let root: Root;
  let translationGet: ReturnType<typeof vi.fn>;
  let translationGenerate: ReturnType<typeof vi.fn>;

  const render = async (translationVisible: boolean): Promise<void> => {
    await act(async () => {
      root.render(createElement(EntryDetail, {
        entry,
        aiViewState: { summaryVisible: false, translationVisible },
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
        aiToolbarTarget: toolbarTarget,
        onAIViewStateChange: vi.fn(),
        onReadingProgressChange: vi.fn().mockResolvedValue(undefined),
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    translationGet = vi.fn().mockResolvedValue({
      ok: true,
      data: { state: 'succeeded', result: translatedResult },
    });
    translationGenerate = vi.fn();
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        content: {
          get: vi.fn().mockResolvedValue({ ok: true, data: content }),
          fetchAndClean: vi.fn(),
        },
        translation: {
          get: translationGet,
          generate: translationGenerate,
          prioritize: vi.fn().mockResolvedValue({ ok: true, data: { accepted: true } }),
          onEvent: vi.fn(() => () => undefined),
        },
        annotation: {
          list: vi.fn().mockResolvedValue({ ok: true, data: [] }),
        },
      } as unknown as typeof window.shaleAPI,
    });
    container = document.createElement('div');
    toolbarTarget = document.createElement('div');
    document.body.append(container, toolbarTarget);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    toolbarTarget.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the current annotation toolbar mounted when switching to an existing Translation', async () => {
    await render(false);

    expect(toolbarTarget.querySelector('[aria-label="开启批注模式"]')).not.toBeNull();
    expect(container.querySelector('.translation-bilingual-content')).toBeNull();

    await render(true);

    expect(container.querySelector('.translation-bilingual-content')).not.toBeNull();
    expect(container.querySelector('[hidden] .entry-detail-html[data-inline-translation-root]')).not
      .toBeNull();
    expect(toolbarTarget.querySelector('[aria-label="开启批注模式"]')).not.toBeNull();
    expect(toolbarTarget.querySelector('[aria-label="翻译或切换双语视图"]')).not.toBeNull();
  });

  it('routes a new toolbar Translation action to the typed preload API', async () => {
    translationGet.mockResolvedValue({ ok: true, data: { state: 'idle' } });
    translationGenerate.mockResolvedValue({
      ok: true,
      data: { runId: 9, reused: false, result: { ...translatedResult, id: 9, status: 'running' } },
    });
    await render(false);

    const translateButton = toolbarTarget.querySelector<HTMLButtonElement>(
      '[aria-label="翻译或切换双语视图"]',
    );
    expect(translateButton).not.toBeNull();
    await act(async () => {
      translateButton?.click();
      await Promise.resolve();
    });

    expect(translationGenerate).toHaveBeenCalledWith({
      entryId: entry.id,
      targetLanguage: 'zh-CN',
      useTerminology: true,
    });
  });
});
