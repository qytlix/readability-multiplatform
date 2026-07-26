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
import type {
  TranslationResult,
  TranslationState,
} from '../../../src/shared/contracts/translation.types';
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

const succeededResult = createTranslationResult('succeeded');
const runningResult = createTranslationResult('running');
const failedResult = createTranslationResult('failed');

describe('Translation toolbar continuity', () => {
  let container: HTMLDivElement;
  let toolbarTarget: HTMLDivElement;
  let root: Root;
  let translationGet: ReturnType<typeof vi.fn>;
  let translationGenerate: ReturnType<typeof vi.fn>;

  const render = async (
    translationVisible: boolean,
    aiPreferences = DEFAULT_AI_PREFERENCES,
  ): Promise<void> => {
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
        aiPreferences,
        aiToolbarTarget: toolbarTarget,
        onAIViewStateChange: vi.fn(),
        onReadingProgressChange: vi.fn().mockResolvedValue(undefined),
      }));
      await settle();
    });
  };

  const remount = async (
    translationState: TranslationState,
    translationVisible: boolean,
    aiPreferences = DEFAULT_AI_PREFERENCES,
  ): Promise<void> => {
    await act(async () => root.unmount());
    root = createRoot(container);
    translationGet.mockResolvedValue({ ok: true, data: translationState });
    await render(translationVisible, aiPreferences);
  };

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    translationGet = vi.fn().mockResolvedValue({ ok: true, data: { state: 'idle' } });
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

  it('keeps the shared Reader toolbar intact before and after starting a Translation', async () => {
    translationGenerate.mockResolvedValue({
      ok: true,
      data: { runId: 9, reused: false, result: runningResult },
    });
    await remount({ state: 'idle' }, false);

    expectOriginalBody();
    expectSingleSharedToolbar();
    await toggleAnnotationMode();

    const translateButton = toolbarTarget.querySelector<HTMLButtonElement>(
      '[aria-label="翻译或切换双语视图"]',
    );
    expect(translateButton).not.toBeNull();
    await act(async () => {
      translateButton?.click();
      await settle();
    });

    expect(translationGenerate).toHaveBeenCalledWith({
      entryId: entry.id,
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN',
      useTerminology: true,
      expertId: 'none',
      useSmartContext: false,
    });
    await render(true);

    expectBilingualBody();
    expectSingleSharedToolbar();
    await toggleAnnotationMode();
  });

  it('keeps one shared toolbar while switching an existing Translation between original and bilingual bodies', async () => {
    await remount({ state: 'succeeded', result: succeededResult }, false);

    expectOriginalBody();
    expectSingleSharedToolbar();
    await toggleAnnotationMode();

    await render(true);

    expectBilingualBody();
    expectSingleSharedToolbar();
    await toggleAnnotationMode();

    await render(false);

    expectOriginalBody();
    expectSingleSharedToolbar();
  });

  it('shows scoped replacement-run feedback and labels its pause controls', async () => {
    const existingResult = createTranslationResult('succeeded');
    const replacementResult: TranslationResult = {
      ...createTranslationResult('running'),
      id: 19,
      segments: existingResult.segments,
    };
    await remount({
      state: 'running',
      result: replacementResult,
      activeResult: existingResult,
    }, true);

    const runningStatus = toolbarTarget.querySelector<HTMLElement>(
      '.translation-retranslation-status',
    );
    expect(runningStatus?.getAttribute('role')).toBe('status');
    expect(runningStatus?.getAttribute('aria-live')).toBe('polite');
    expect(runningStatus?.getAttribute('data-translation-run-id')).toBe('19');
    expect(runningStatus?.textContent).toContain('正在重新翻译… 当前显示上一版译文');
    expect(runningStatus?.querySelector('.mini-spinner')).not.toBeNull();
    const pauseButton = toolbarTarget.querySelector<HTMLButtonElement>(
      '[aria-label="暂停重新翻译"]',
    );
    expect(pauseButton?.hasAttribute('title')).toBe(false);
    expect(
      pauseButton?.closest('.article-action-tooltip')?.getAttribute('data-tooltip'),
    ).toBe('翻译');

    const pausedResult: TranslationResult = {
      ...replacementResult,
      status: 'failed',
      error: {
        code: 'TRANSLATION_PAUSED',
        message: 'Translation was paused.',
        retryable: true,
      },
    };
    await remount({
      state: 'paused',
      result: pausedResult,
      activeResult: existingResult,
    }, true);
    const pausedStatus = toolbarTarget.querySelector<HTMLElement>(
      '.translation-retranslation-status',
    );
    expect(pausedStatus?.textContent).toContain('重新翻译已暂停 · 当前仍显示上一版译文');
    expect(pausedStatus?.querySelector('.mini-spinner')).toBeNull();
    const resumeButton = toolbarTarget.querySelector<HTMLButtonElement>(
      '[aria-label="继续重新翻译"]',
    );
    expect(resumeButton?.hasAttribute('title')).toBe(false);
    expect(
      resumeButton?.closest('.article-action-tooltip')?.getAttribute('data-tooltip'),
    ).toBe('翻译');

    const otherLanguagePreferences = {
      ...DEFAULT_AI_PREFERENCES,
      translationTargetLanguage: 'ja' as const,
    };
    await remount({ state: 'idle' }, false, otherLanguagePreferences);
    expect(toolbarTarget.querySelector('.translation-retranslation-status')).toBeNull();
    expect(toolbarTarget.querySelector('[aria-label="暂停重新翻译"]')).toBeNull();
  });

  it.each([
    ['loading', { state: 'running', result: runningResult }],
    ['success', { state: 'succeeded', result: succeededResult }],
    ['failure', { state: 'failed', result: failedResult }],
  ] as const)('keeps the annotation action functional in Translation %s state', async (
    _label,
    translationState,
  ) => {
    await remount(translationState, true);

    expectBilingualBody();
    expectSingleSharedToolbar();
    await toggleAnnotationMode();
  });

  function expectOriginalBody(): void {
    expect(container.querySelector('.translation-bilingual-content')).toBeNull();
    const originalArticle = container.querySelector('.entry-detail-html[data-inline-translation-root]');
    expect(originalArticle).not.toBeNull();
    expect(originalArticle?.closest('div[hidden]')).toBeNull();
  }

  function expectBilingualBody(): void {
    expect(container.querySelector('.translation-bilingual-content')).not.toBeNull();
    const originalArticle = container.querySelector('.entry-detail-html[data-inline-translation-root]');
    expect(originalArticle?.closest('div[hidden]')).not.toBeNull();
  }

  function expectSingleSharedToolbar(): void {
    expect(toolbarTarget.querySelectorAll('.entry-detail-ai-actions')).toHaveLength(1);
    expect(toolbarTarget.querySelectorAll('.annotation-toolbar')).toHaveLength(1);
    expect(toolbarTarget.querySelectorAll('.annotation-tool-button')).toHaveLength(1);
    const aiButtons = toolbarTarget.querySelectorAll<HTMLButtonElement>(
      '.entry-detail-ai-actions button',
    );
    const aiTooltips = Array.from(toolbarTarget.querySelectorAll<HTMLElement>(
      '.entry-detail-ai-actions > .article-action-tooltip',
    )).map((tooltip) => tooltip.getAttribute('data-tooltip'));
    expect(aiButtons).toHaveLength(2);
    expect(aiTooltips).toEqual(['总结', '翻译']);
    aiButtons.forEach((button) => {
      expect(button.closest('.article-action-tooltip')).not.toBeNull();
      expect(button.hasAttribute('title')).toBe(false);
    });
    expect(toolbarTarget.querySelectorAll(
      '[aria-label="翻译或切换双语视图"], [aria-label="暂停翻译"], [aria-label="显示译文"], [aria-label="隐藏译文"]',
    )).toHaveLength(1);
  }

  async function toggleAnnotationMode(): Promise<void> {
    const annotationButton = toolbarTarget.querySelector<HTMLButtonElement>(
      '.annotation-tool-button',
    );
    expect(annotationButton).not.toBeNull();
    await act(async () => {
      annotationButton?.click();
      await Promise.resolve();
    });
    expect(annotationButton?.getAttribute('aria-pressed')).toBe('true');
    await act(async () => {
      annotationButton?.click();
      await Promise.resolve();
    });
    expect(annotationButton?.getAttribute('aria-pressed')).toBe('false');
  }
});

function createTranslationResult(
  status: TranslationResult['status'],
): TranslationResult {
  return {
    id: status === 'succeeded' ? 8 : status === 'running' ? 9 : 10,
    entryId: entry.id,
    sourceLanguage: 'auto',
    targetLanguage: 'zh-CN',
    sourceContentHash: 'content-hash',
    segmenterVersion: 'v3',
    terminologyPackVersion: 'none',
    promptVersion: 'translation-v1',
    expertId: 'none',
    expertContentHash: 'none',
    smartContextEnabled: false,
    contextPromptVersion: 'none',
    status,
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    ...(status === 'failed'
      ? { error: { code: 'TRANSLATION_PROVIDER_TIMEOUT', message: 'Timed out.', retryable: true } }
      : {}),
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
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
