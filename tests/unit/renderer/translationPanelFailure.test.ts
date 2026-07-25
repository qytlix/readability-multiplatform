// @vitest-environment jsdom

import {
  act,
  createElement,
  createRef,
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

    expect(container.querySelector('.entry-detail-ai-error')?.textContent)
      .toContain('3 segments remain untranslated.');
    expect(container.querySelector('.entry-detail-ai-error')?.textContent)
      .toContain('The provider did not respond before Translation timed out.');

    act(() => root.unmount());
    container.remove();
  });
});
