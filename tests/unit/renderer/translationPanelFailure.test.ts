// @vitest-environment jsdom

import {
  act,
  createElement,
  createRef,
  type MouseEvent,
} from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  TranslationResult,
  TranslationState,
  TranslationStreamEvent,
} from '../../../src/shared/contracts/translation.types';
import {
  TranslationPanel,
  type TranslationPanelHandle,
} from '../../../src/renderer/features/translation/TranslationPanel';

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function createResult(status: TranslationResult['status']): TranslationResult {
  return {
    id: 7,
    entryId: 12,
    sourceLanguage: 'auto',
    targetLanguage: 'zh-CN',
    sourceContentHash: 'content-hash',
    segmenterVersion: 'segmenter-v1',
    terminologyPackVersion: 'none',
    promptVersion: 'translation-v1',
    expertId: 'builtin:general',
    expertContentHash: 'builtin:general',
    smartContextEnabled: false,
    contextPromptVersion: 'none',
    status,
    ...(status === 'failed' ? {
      error: {
        code: 'TRANSLATION_PROVIDER_TIMEOUT',
        message: 'The provider did not respond before Translation timed out.',
        retryable: true,
      },
    } : {}),
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    segments: [
      {
        sourceSegmentId: 'completed',
        orderIndex: 0,
        sourceType: 'title',
        sourceHtml: '<h2>Title</h2>',
        sourceText: 'Title',
        translatedHtml: '<h2>Translated title</h2>',
        translatedText: 'Translated title',
        terminologyMatches: [],
        status: 'succeeded',
      },
      {
        sourceSegmentId: 'failed',
        orderIndex: 1,
        sourceType: 'paragraph',
        sourceHtml: '<p>First</p>',
        sourceText: 'First',
        terminologyMatches: [],
        status: status === 'failed' ? 'failed' : 'pending',
      },
      {
        sourceSegmentId: 'pending-1',
        orderIndex: 2,
        sourceType: 'paragraph',
        sourceHtml: '<p>Second</p>',
        sourceText: 'Second',
        terminologyMatches: [],
        status: 'pending',
      },
      {
        sourceSegmentId: 'pending-2',
        orderIndex: 3,
        sourceType: 'paragraph',
        sourceHtml: '<p>Third</p>',
        sourceText: 'Third',
        terminologyMatches: [],
        status: 'pending',
      },
    ],
  };
}

describe('TranslationPanel failure feedback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows a failed result and the number of untranslated segments', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const runningResult = createResult('running');
    const failedResult = createResult('failed');
    let state: TranslationState = { state: 'idle' };
    let eventListener: ((event: TranslationStreamEvent) => void) | undefined;
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        translation: {
          get: vi.fn(() => Promise.resolve({ ok: true, data: state })),
          generate: vi.fn(() => {
            state = { state: 'running', result: runningResult };
            return Promise.resolve({
              ok: true,
              data: { runId: runningResult.id, reused: false, result: runningResult },
            });
          }),
          prioritize: vi.fn().mockResolvedValue({ ok: true, data: { accepted: true } }),
          onEvent: vi.fn((listener: (event: TranslationStreamEvent) => void) => {
            eventListener = listener;
            return () => undefined;
          }),
        },
      } as unknown as typeof window.shaleAPI,
    });

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const panelRef = createRef<TranslationPanelHandle>();

    await act(async () => {
      root.render(createElement(TranslationPanel, {
        ref: panelRef,
        entryId: runningResult.entryId,
        isContentReady: true,
        sourceLanguage: runningResult.sourceLanguage,
        targetLanguage: runningResult.targetLanguage,
        useTerminology: false,
        useSmartContext: false,
        expertId: runningResult.expertId,
        shortcut: {
          key: 'T',
          ctrlKey: true,
          altKey: false,
          shiftKey: false,
          metaKey: false,
        },
        sourceHtml: '<p>First</p><p>Second</p><p>Third</p>',
        titleTarget: null,
        isBilingualVisible: true,
        onContentClick: vi.fn(),
        onGeneratingChange: vi.fn(),
        onBilingualChange: vi.fn(),
        onTitleTranslatingChange: vi.fn(),
        children: createElement('p', undefined, 'Original article'),
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      panelRef.current?.activate();
      await Promise.resolve();
      await Promise.resolve();
    });

    const failedSegment = runningResult.segments.find((segment) =>
      segment.sourceSegmentId === 'failed');
    if (!failedSegment) throw new Error('Expected a pending segment.');
    await act(async () => {
      eventListener?.({
        type: 'segment-failed',
        runId: runningResult.id,
        entryId: runningResult.entryId,
        sourceLanguage: runningResult.sourceLanguage,
        targetLanguage: runningResult.targetLanguage,
        sourceSegmentId: failedSegment.sourceSegmentId,
        segment: {
          ...failedSegment,
          status: 'failed',
          error: {
            code: 'TRANSLATION_EMPTY_OUTPUT',
            message: 'The provider returned no readable Translation output.',
            retryable: true,
          },
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('.translation-segment-untranslated')?.textContent)
      .toBe('Untranslated');
    expect(container.querySelector('[data-segment-id="failed"] .translation-segment-spinner'))
      .toBeNull();

    state = { state: 'failed', result: failedResult };
    await act(async () => {
      eventListener?.({
        type: 'failed',
        runId: failedResult.id,
        entryId: failedResult.entryId,
        sourceLanguage: failedResult.sourceLanguage,
        targetLanguage: failedResult.targetLanguage,
        error: failedResult.error ?? {
          code: 'TRANSLATION_UNKNOWN_ERROR',
          message: 'Unknown Translation error.',
          retryable: false,
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    const popup = container.querySelector<HTMLElement>('.translation-error-popup');
    expect(popup).not.toBeNull();
    expect(popup?.getAttribute('role')).toBe('alert');
    expect(popup?.textContent).toContain('Translation paused');
    expect(popup?.textContent)
      .toContain('3 segments remain untranslated.');
    expect(popup?.textContent)
      .toContain('The provider did not respond before Translation timed out.');
    expect(popup?.textContent).toContain('Retry remaining');
    expect(container.querySelector('.entry-detail-ai-error')).toBeNull();

    await act(async () => {
      popup?.querySelector<HTMLButtonElement>('[aria-label="Dismiss Translation error"]')
        ?.click();
    });
    expect(container.querySelector('.translation-error-popup')).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it('forwards clicks from bilingual source and translated links to the Reader handler', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const succeededResult = createResult('succeeded');
    succeededResult.segments = [
      {
        sourceSegmentId: 'linked-paragraph',
        orderIndex: 0,
        sourceType: 'paragraph',
        sourceHtml: '<p>Read <a href="/story">the story</a>.</p>',
        sourceText: 'Read the story.',
        translatedHtml: '<p>阅读<a href="/story">这篇报道</a>。</p>',
        translatedText: '阅读这篇报道。',
        terminologyMatches: [],
        status: 'succeeded',
      },
    ];
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        translation: {
          get: vi.fn().mockResolvedValue({
            ok: true,
            data: { state: 'succeeded', result: succeededResult },
          }),
          generate: vi.fn(),
          prioritize: vi.fn().mockResolvedValue({ ok: true, data: { accepted: true } }),
          onEvent: vi.fn(() => () => undefined),
        },
      } as unknown as typeof window.shaleAPI,
    });

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onContentClick = vi.fn((event: MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
    });

    await act(async () => {
      root.render(createElement(TranslationPanel, {
        entryId: succeededResult.entryId,
        isContentReady: true,
        sourceLanguage: succeededResult.sourceLanguage,
        targetLanguage: succeededResult.targetLanguage,
        useTerminology: false,
        useSmartContext: false,
        expertId: succeededResult.expertId,
        shortcut: {
          key: 'T',
          ctrlKey: true,
          altKey: false,
          shiftKey: false,
          metaKey: false,
        },
        sourceHtml: '<p>Read <a href="/story">the story</a>.</p>',
        titleTarget: null,
        isBilingualVisible: true,
        onContentClick,
        onGeneratingChange: vi.fn(),
        onBilingualChange: vi.fn(),
        onTitleTranslatingChange: vi.fn(),
        children: createElement('p', undefined, 'Original article'),
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const links = container.querySelectorAll<HTMLAnchorElement>(
      '.translation-bilingual-body a[href="/story"]',
    );
    expect(links).toHaveLength(2);

    act(() => {
      links[0]?.click();
      links[1]?.click();
    });
    expect(onContentClick).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
    container.remove();
  });
});
