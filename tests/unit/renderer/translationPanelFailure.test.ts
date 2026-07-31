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
  getDisplayedResult,
  mergeUpdatedSegment,
  type TranslationPanelHandle,
} from '../../../src/renderer/features/translation/TranslationPanel';

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

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
    translationVariant: 'standard',
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

function succeededResult(): TranslationResult {
  const result = createResult('succeeded');
  return {
    ...result,
    segments: result.segments.map((segment) => ({
      ...segment,
      status: 'succeeded' as const,
      translatedHtml: segment.translatedHtml ?? `<p>${segment.sourceText} translated</p>`,
      translatedText: segment.translatedText ?? `${segment.sourceText} translated`,
    })),
  };
}

describe('TranslationPanel failure feedback', () => {
  afterEach(() => {
    vi.useRealTimers();
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
    expect(popup?.textContent).toContain('Translation failed');
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

  it('pauses and resumes from the same Translation control', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const runningResult = createResult('running');
    const pausedResult: TranslationResult = {
      ...runningResult,
      status: 'failed',
      error: {
        code: 'TRANSLATION_PAUSED',
        message: 'Translation was paused.',
        retryable: true,
      },
    };
    const pause = vi.fn().mockResolvedValue({
      ok: true,
      data: { paused: true, result: pausedResult },
    });
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      data: { runId: runningResult.id, reused: false, result: runningResult },
    });
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        translation: {
          get: vi.fn().mockResolvedValue({
            ok: true,
            data: { state: 'running', result: runningResult },
          }),
          generate,
          pause,
          prioritize: vi.fn().mockResolvedValue({ ok: true, data: { accepted: true } }),
          onEvent: vi.fn(() => () => undefined),
        },
      } as unknown as typeof window.shaleAPI,
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const panelRef = createRef<TranslationPanelHandle>();
    const onGeneratingChange = vi.fn();
    const onBilingualChange = vi.fn();

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
        onGeneratingChange,
        onBilingualChange,
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
    expect(pause).toHaveBeenCalledWith(expect.objectContaining({
      runId: runningResult.id,
      entryId: runningResult.entryId,
    }));
    expect(onGeneratingChange).toHaveBeenLastCalledWith(false);
    expect(onBilingualChange).toHaveBeenCalledWith(true);
    expect(container.querySelector('.translation-error-popup')).toBeNull();
    expect(container.querySelector('.translation-pause-toast')?.textContent)
      .toBe('翻译已暂停，再次点击翻译按钮可继续。');

    await act(async () => {
      panelRef.current?.activate();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(generate).toHaveBeenCalledOnce();
    expect(onGeneratingChange).toHaveBeenLastCalledWith(true);
    expect(container.querySelector('.translation-pause-toast')).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it('toggles a complete Translation from the main control and only force-starts a replacement on request', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const existingResult: TranslationResult = {
      ...createResult('succeeded'),
      segments: createResult('succeeded').segments.map((segment) => ({
        ...segment,
        status: 'succeeded' as const,
        translatedHtml: segment.translatedHtml ?? `<p>${segment.sourceText} translated</p>`,
        translatedText: segment.translatedText ?? `${segment.sourceText} translated`,
      })),
    };
    const replacement: TranslationResult = {
      ...existingResult,
      id: 8,
      status: 'running',
      segments: existingResult.segments.map((segment) => ({
        ...segment,
        status: 'pending' as const,
        translatedHtml: undefined,
        translatedText: undefined,
      })),
    };
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        runId: replacement.id,
        reused: false,
        result: replacement,
        activeResult: existingResult,
      },
    });
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        translation: {
          get: vi.fn().mockResolvedValue({
            ok: true,
            data: { state: 'succeeded', result: existingResult },
          }),
          generate,
          prioritize: vi.fn().mockResolvedValue({ ok: true, data: { accepted: true } }),
          onEvent: vi.fn(() => () => undefined),
        },
      } as unknown as typeof window.shaleAPI,
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const panelRef = createRef<TranslationPanelHandle>();
    const onBilingualChange = vi.fn();

    await act(async () => {
      root.render(createElement(TranslationPanel, {
        ref: panelRef,
        entryId: existingResult.entryId,
        isContentReady: true,
        sourceLanguage: existingResult.sourceLanguage,
        targetLanguage: existingResult.targetLanguage,
        useTerminology: false,
        useSmartContext: false,
        expertId: existingResult.expertId,
        shortcut: { key: 'T', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
        sourceHtml: '<h2>Title</h2><p>First</p><p>Second</p><p>Third</p>',
        titleTarget: null,
        isBilingualVisible: false,
        onContentClick: vi.fn(),
        onGeneratingChange: vi.fn(),
        onBilingualChange,
        onTitleTranslatingChange: vi.fn(),
        children: createElement('p', undefined, 'Original article'),
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      panelRef.current?.activate();
      await Promise.resolve();
    });
    expect(onBilingualChange).toHaveBeenCalledWith(true);
    expect(generate).not.toHaveBeenCalled();

    await act(async () => {
      root.render(createElement(TranslationPanel, {
        ref: panelRef,
        entryId: existingResult.entryId,
        isContentReady: true,
        sourceLanguage: existingResult.sourceLanguage,
        targetLanguage: existingResult.targetLanguage,
        useTerminology: false,
        useSmartContext: false,
        expertId: existingResult.expertId,
        shortcut: { key: 'T', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
        sourceHtml: '<h2>Title</h2><p>First</p><p>Second</p><p>Third</p>',
        titleTarget: null,
        isBilingualVisible: true,
        onContentClick: vi.fn(),
        onGeneratingChange: vi.fn(),
        onBilingualChange,
        onTitleTranslatingChange: vi.fn(),
        children: createElement('p', undefined, 'Original article'),
      }));
      await Promise.resolve();
    });

    await act(async () => {
      panelRef.current?.activate();
      await Promise.resolve();
    });
    expect(onBilingualChange).toHaveBeenLastCalledWith(false);
    expect(generate).not.toHaveBeenCalled();

    await act(async () => {
      const outcome = await panelRef.current?.requestRetranslation();
      expect(outcome).toBe('started');
      await Promise.resolve();
    });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      entryId: existingResult.entryId,
      forceNew: true,
    }));

    act(() => root.unmount());
    container.remove();
  });

  it.each([
    { completedVariant: 'standard' as const, selectedVariant: 'deep' as const },
    { completedVariant: 'deep' as const, selectedVariant: 'standard' as const },
  ])('keeps a $completedVariant result displayable after switching to $selectedVariant', async ({
    completedVariant,
    selectedVariant,
  }) => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const completed: TranslationResult = {
      ...succeededResult(),
      translationVariant: completedVariant,
    };
    const generate = vi.fn();
    const onBilingualChange = vi.fn();
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        translation: {
          get: vi.fn().mockResolvedValue({
            ok: true,
            data: { state: 'succeeded', result: completed },
          }),
          generate,
          prioritize: vi.fn().mockResolvedValue({ ok: true, data: { accepted: true } }),
          onEvent: vi.fn(() => () => undefined),
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
        entryId: completed.entryId,
        isContentReady: true,
        sourceLanguage: completed.sourceLanguage,
        targetLanguage: completed.targetLanguage,
        useTerminology: false,
        useSmartContext: false,
        translationMode: completedVariant,
        expertId: completed.expertId,
        shortcut: { key: 'T', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
        sourceHtml: '<h2>Title</h2><p>First</p><p>Second</p><p>Third</p>',
        titleTarget: null,
        isBilingualVisible: true,
        onContentClick: vi.fn(),
        onGeneratingChange: vi.fn(),
        onBilingualChange,
        onTitleTranslatingChange: vi.fn(),
        children: createElement('p', undefined, 'Original article'),
      }));
      await settle();
    });
    expect(container.textContent).toContain('First translated');

    await act(async () => {
      root.render(createElement(TranslationPanel, {
        ref: panelRef,
        entryId: completed.entryId,
        isContentReady: true,
        sourceLanguage: completed.sourceLanguage,
        targetLanguage: completed.targetLanguage,
        useTerminology: false,
        useSmartContext: false,
        translationMode: selectedVariant,
        expertId: completed.expertId,
        shortcut: { key: 'T', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
        sourceHtml: '<h2>Title</h2><p>First</p><p>Second</p><p>Third</p>',
        titleTarget: null,
        isBilingualVisible: true,
        onContentClick: vi.fn(),
        onGeneratingChange: vi.fn(),
        onBilingualChange,
        onTitleTranslatingChange: vi.fn(),
        children: createElement('p', undefined, 'Original article'),
      }));
      await settle();
    });
    expect(container.textContent).toContain('First translated');

    await act(async () => {
      panelRef.current?.activate();
      await settle();
    });
    expect(onBilingualChange).toHaveBeenLastCalledWith(false);
    expect(generate).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it('refreshes canonical state before starting from a stale no-result Renderer state', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const deepRunning: TranslationResult = {
      ...createResult('running'),
      id: 41,
      translationVariant: 'deep',
    };
    const get = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { state: 'idle' } })
      .mockResolvedValue({ ok: true, data: { state: 'running', result: deepRunning } });
    const generate = vi.fn();
    const pause = vi.fn();
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        translation: {
          get,
          generate,
          pause,
          prioritize: vi.fn().mockResolvedValue({ ok: true, data: { accepted: true } }),
          onEvent: vi.fn(() => () => undefined),
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
        entryId: deepRunning.entryId,
        isContentReady: true,
        sourceLanguage: deepRunning.sourceLanguage,
        targetLanguage: deepRunning.targetLanguage,
        useTerminology: false,
        useSmartContext: false,
        translationMode: 'standard',
        expertId: deepRunning.expertId,
        shortcut: { key: 'T', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
        sourceHtml: '<p>First</p>',
        titleTarget: null,
        isBilingualVisible: false,
        onContentClick: vi.fn(),
        onGeneratingChange: vi.fn(),
        onBilingualChange: vi.fn(),
        onTitleTranslatingChange: vi.fn(),
        children: createElement('p', undefined, 'Original article'),
      }));
      await settle();
    });

    await act(async () => {
      panelRef.current?.activate();
      await settle();
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(generate).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it('waits for the settings acknowledgement before a new Translation starts', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    let allowStart: ((allowed: boolean) => void) | undefined;
    const beforeTranslationStart = vi.fn(() => new Promise<boolean>((resolve) => {
      allowStart = resolve;
    }));
    const runningResult = createResult('running');
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      data: { runId: runningResult.id, reused: false, result: runningResult },
    });
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        translation: {
          get: vi.fn().mockResolvedValue({ ok: true, data: { state: 'idle' } }),
          generate,
          prioritize: vi.fn().mockResolvedValue({ ok: true, data: { accepted: true } }),
          onEvent: vi.fn(() => () => undefined),
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
        translationMode: 'deep',
        expertId: runningResult.expertId,
        shortcut: { key: 'T', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
        sourceHtml: '<p>First</p>',
        titleTarget: null,
        isBilingualVisible: false,
        onContentClick: vi.fn(),
        onGeneratingChange: vi.fn(),
        onBilingualChange: vi.fn(),
        onTitleTranslatingChange: vi.fn(),
        beforeTranslationStart,
        children: createElement('p', undefined, 'Original article'),
      }));
      await Promise.resolve();
    });

    await act(async () => {
      panelRef.current?.activate();
      await Promise.resolve();
    });
    expect(beforeTranslationStart).toHaveBeenCalledOnce();
    expect(generate).not.toHaveBeenCalled();

    await act(async () => {
      allowStart?.(true);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      translationMode: 'deep',
    }));

    act(() => root.unmount());
    container.remove();
  });

  it('keeps the complete previous Translation while replacement segments settle', () => {
    const original = succeededResult();
    const candidate: TranslationResult = {
      ...original,
      id: original.id + 1,
      status: 'running',
      segments: original.segments.map((segment) => ({
        ...segment,
        status: 'pending' as const,
        translatedHtml: undefined,
        translatedText: undefined,
      })),
    };
    const state: TranslationState = {
      state: 'running',
      result: candidate,
      activeResult: original,
    };
    const replacement = candidate.segments[1];
    if (!replacement) throw new Error('Expected a replacement segment.');
    const persistedReplacement = {
      ...replacement,
      status: 'succeeded' as const,
      translatedText: 'Newly translated paragraph.',
      translatedHtml: '<p>Newly translated paragraph.</p>',
    };

    const afterSuccess = mergeUpdatedSegment(state, persistedReplacement);
    const displayedAfterSuccess = getDisplayedResult(afterSuccess);
    expect(displayedAfterSuccess?.id).toBe(original.id);
    expect(displayedAfterSuccess?.segments[1]?.translatedText)
      .toBe(original.segments[1]?.translatedText);

    const failureCandidate = candidate.segments[2];
    if (!failureCandidate) throw new Error('Expected a second replacement segment.');
    const failedReplacement = {
      ...failureCandidate,
      status: 'failed' as const,
      error: {
        code: 'TRANSLATION_PROVIDER_TIMEOUT',
        message: 'The provider timed out.',
        retryable: true,
      },
    };
    const afterFailure = mergeUpdatedSegment(afterSuccess, failedReplacement);
    expect(getDisplayedResult(afterFailure)?.segments[2]?.translatedText)
      .toBe(original.segments[2]?.translatedText);
  });

  it('announces a replacement run only after its matching completed event, even when text is unchanged', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    const existingResult = succeededResult();
    const replacementResult: TranslationResult = {
      ...existingResult,
      id: 8,
      status: 'running',
    };
    const state: TranslationState = {
      state: 'running',
      result: replacementResult,
      activeResult: existingResult,
    };
    let eventListener: ((event: TranslationStreamEvent) => void) | undefined;
    const onRetranslationStatusChange = vi.fn();
    const generate = vi.fn();
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        translation: {
          get: vi.fn(() => Promise.resolve({ ok: true, data: state })),
          generate,
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

    await act(async () => {
      root.render(createElement(TranslationPanel, {
        entryId: existingResult.entryId,
        isContentReady: true,
        sourceLanguage: existingResult.sourceLanguage,
        targetLanguage: existingResult.targetLanguage,
        useTerminology: false,
        useSmartContext: false,
        expertId: existingResult.expertId,
        shortcut: { key: 'T', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
        sourceHtml: '<h2>Title</h2><p>First</p><p>Second</p><p>Third</p>',
        titleTarget: null,
        isBilingualVisible: true,
        onContentClick: vi.fn(),
        onGeneratingChange: vi.fn(),
        onBilingualChange: vi.fn(),
        onTitleTranslatingChange: vi.fn(),
        onRetranslationStatusChange,
        children: createElement('p', undefined, 'Original article'),
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onRetranslationStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({
      runId: replacementResult.id,
      state: 'running',
    }));

    const firstReplacementSegment = replacementResult.segments[0];
    if (!firstReplacementSegment) throw new Error('Expected a replacement segment.');
    await act(async () => {
      eventListener?.({
        type: 'completed',
        runId: existingResult.id,
        entryId: existingResult.entryId,
        sourceLanguage: existingResult.sourceLanguage,
        targetLanguage: existingResult.targetLanguage,
        result: existingResult,
      });
      await Promise.resolve();
    });
    expect(onRetranslationStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({
      runId: replacementResult.id,
      state: 'running',
    }));

    await act(async () => {
      eventListener?.({
        type: 'segment-completed',
        runId: replacementResult.id,
        entryId: replacementResult.entryId,
        sourceLanguage: replacementResult.sourceLanguage,
        targetLanguage: replacementResult.targetLanguage,
        sourceSegmentId: firstReplacementSegment.sourceSegmentId,
        segment: firstReplacementSegment,
      });
      await Promise.resolve();
    });
    expect(onRetranslationStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'running',
    }));

    const completedReplacement: TranslationResult = {
      ...replacementResult,
      status: 'succeeded',
    };
    await act(async () => {
      eventListener?.({
        type: 'completed',
        runId: replacementResult.id,
        entryId: replacementResult.entryId,
        sourceLanguage: replacementResult.sourceLanguage,
        targetLanguage: replacementResult.targetLanguage,
        result: completedReplacement,
      });
      await Promise.resolve();
    });
    expect(onRetranslationStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({
      runId: replacementResult.id,
      state: 'completed',
    }));
    expect(generate).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(2_999);
    });
    expect(onRetranslationStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'completed',
    }));
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(onRetranslationStatusChange).toHaveBeenLastCalledWith(null);

    act(() => root.unmount());
    container.remove();
  });

  it('keeps replacement failure feedback until dismissed and never labels an initial run as a retranslation', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const existingResult = succeededResult();
    const replacementResult: TranslationResult = {
      ...existingResult,
      id: 8,
      status: 'running',
    };
    let state: TranslationState = {
      state: 'running',
      result: replacementResult,
      activeResult: existingResult,
    };
    let eventListener: ((event: TranslationStreamEvent) => void) | undefined;
    const onRetranslationStatusChange = vi.fn();
    const onBilingualChange = vi.fn();
    const generate = vi.fn();
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        translation: {
          get: vi.fn(() => Promise.resolve({ ok: true, data: state })),
          generate,
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
        entryId: existingResult.entryId,
        isContentReady: true,
        sourceLanguage: existingResult.sourceLanguage,
        targetLanguage: existingResult.targetLanguage,
        useTerminology: false,
        useSmartContext: false,
        expertId: existingResult.expertId,
        shortcut: { key: 'T', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
        sourceHtml: '<h2>Title</h2><p>First</p><p>Second</p><p>Third</p>',
        titleTarget: null,
        isBilingualVisible: true,
        onContentClick: vi.fn(),
        onGeneratingChange: vi.fn(),
        onBilingualChange,
        onTitleTranslatingChange: vi.fn(),
        onRetranslationStatusChange,
        children: createElement('p', undefined, 'Original article'),
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    state = { state: 'succeeded', result: existingResult };
    await act(async () => {
      eventListener?.({
        type: 'failed',
        runId: replacementResult.id,
        entryId: replacementResult.entryId,
        sourceLanguage: replacementResult.sourceLanguage,
        targetLanguage: replacementResult.targetLanguage,
        error: {
          code: 'TRANSLATION_PROVIDER_TIMEOUT',
          message: 'The provider timed out.',
          retryable: true,
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onRetranslationStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({
      runId: replacementResult.id,
      state: 'failed',
    }));
    const popup = container.querySelector<HTMLElement>('.translation-error-popup');
    expect(popup?.textContent).toContain('重新翻译失败 · 已保留上一版译文');
    expect(popup?.querySelector('.translation-error-popup-retry')).toBeNull();

    await act(async () => {
      popup?.querySelector<HTMLButtonElement>('[aria-label="Dismiss Translation error"]')?.click();
    });
    expect(onRetranslationStatusChange).toHaveBeenLastCalledWith(null);

    await act(async () => {
      panelRef.current?.activate();
      await settle();
    });
    expect(onBilingualChange).toHaveBeenLastCalledWith(false);
    expect(generate).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it('uses the existing pause and resume calls for a replacement run', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const existingResult = succeededResult();
    const replacementResult: TranslationResult = {
      ...existingResult,
      id: 8,
      status: 'running',
    };
    const pausedResult: TranslationResult = {
      ...replacementResult,
      status: 'failed',
      error: {
        code: 'TRANSLATION_PAUSED',
        message: 'Translation was paused.',
        retryable: true,
      },
    };
    const pause = vi.fn().mockResolvedValue({
      ok: true,
      data: { paused: true, result: pausedResult },
    });
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        runId: replacementResult.id,
        reused: true,
        result: replacementResult,
        activeResult: existingResult,
      },
    });
    const onRetranslationStatusChange = vi.fn();
    let eventListener: ((event: TranslationStreamEvent) => void) | undefined;
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        translation: {
          get: vi.fn().mockResolvedValue({
            ok: true,
            data: {
              state: 'running',
              result: replacementResult,
              activeResult: existingResult,
            },
          }),
          generate,
          pause,
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
        entryId: existingResult.entryId,
        isContentReady: true,
        sourceLanguage: existingResult.sourceLanguage,
        targetLanguage: existingResult.targetLanguage,
        useTerminology: false,
        useSmartContext: false,
        expertId: existingResult.expertId,
        shortcut: { key: 'T', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
        sourceHtml: '<h2>Title</h2><p>First</p><p>Second</p><p>Third</p>',
        titleTarget: null,
        isBilingualVisible: true,
        onContentClick: vi.fn(),
        onGeneratingChange: vi.fn(),
        onBilingualChange: vi.fn(),
        onTitleTranslatingChange: vi.fn(),
        onRetranslationStatusChange,
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
    expect(pause).toHaveBeenCalledWith(expect.objectContaining({
      entryId: existingResult.entryId,
      runId: replacementResult.id,
    }));
    expect(onRetranslationStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({
      runId: replacementResult.id,
      state: 'paused',
    }));
    expect(container.querySelector('.translation-pause-toast')).toBeNull();

    await act(async () => {
      panelRef.current?.activate();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      entryId: existingResult.entryId,
      targetLanguage: existingResult.targetLanguage,
    }));
    expect(generate).not.toHaveBeenCalledWith(expect.objectContaining({ forceNew: true }));
    expect(onRetranslationStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({
      runId: replacementResult.id,
      state: 'running',
    }));

    await act(async () => {
      eventListener?.({
        type: 'completed',
        runId: replacementResult.id,
        entryId: replacementResult.entryId,
        sourceLanguage: replacementResult.sourceLanguage,
        targetLanguage: replacementResult.targetLanguage,
        result: { ...replacementResult, status: 'succeeded' },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onRetranslationStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({
      runId: replacementResult.id,
      state: 'completed',
    }));
    expect(onRetranslationStatusChange).not.toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'paused',
    }));
    expect(container.querySelector('.translation-pause-toast')).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it('blocks retranslation with deep-specific semantics while a deep run is active', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const deepRunningResult: TranslationResult = {
      ...createResult('running'),
      translationVariant: 'deep',
    };
    const generate = vi.fn();
    const pause = vi.fn();
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        translation: {
          get: vi.fn().mockResolvedValue({
            ok: true,
            data: { state: 'running', result: deepRunningResult },
          }),
          generate,
          pause,
          prioritize: vi.fn().mockResolvedValue({ ok: true, data: { accepted: true } }),
          onEvent: vi.fn(() => () => undefined),
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
        entryId: deepRunningResult.entryId,
        isContentReady: true,
        sourceLanguage: deepRunningResult.sourceLanguage,
        targetLanguage: deepRunningResult.targetLanguage,
        useTerminology: false,
        useSmartContext: false,
        translationMode: 'standard',
        expertId: deepRunningResult.expertId,
        shortcut: { key: 'T', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
        sourceHtml: '<p>First</p>',
        titleTarget: null,
        isBilingualVisible: true,
        onContentClick: vi.fn(),
        onGeneratingChange: vi.fn(),
        onBilingualChange: vi.fn(),
        onTitleTranslatingChange: vi.fn(),
        children: createElement('p', undefined, 'Original article'),
      }));
      await settle();
    });

    await expect(panelRef.current?.requestRetranslation()).resolves.toBe('active-deep');
    await act(async () => {
      panelRef.current?.activate();
      await settle();
    });
    expect(generate).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it('does not emit retranslation feedback for a first Translation run', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const initialRun = createResult('running');
    const onRetranslationStatusChange = vi.fn();
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        translation: {
          get: vi.fn().mockResolvedValue({ ok: true, data: { state: 'running', result: initialRun } }),
          generate: vi.fn(),
          prioritize: vi.fn().mockResolvedValue({ ok: true, data: { accepted: true } }),
          onEvent: vi.fn(() => () => undefined),
        },
      } as unknown as typeof window.shaleAPI,
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(TranslationPanel, {
        entryId: initialRun.entryId,
        isContentReady: true,
        sourceLanguage: initialRun.sourceLanguage,
        targetLanguage: initialRun.targetLanguage,
        useTerminology: false,
        useSmartContext: false,
        expertId: initialRun.expertId,
        shortcut: { key: 'T', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
        sourceHtml: '<p>First</p><p>Second</p><p>Third</p>',
        titleTarget: null,
        isBilingualVisible: true,
        onContentClick: vi.fn(),
        onGeneratingChange: vi.fn(),
        onBilingualChange: vi.fn(),
        onTitleTranslatingChange: vi.fn(),
        onRetranslationStatusChange,
        children: createElement('p', undefined, 'Original article'),
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onRetranslationStatusChange).toHaveBeenLastCalledWith(null);

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

  it('keeps a standard fallback visible while immediately starting a selected deep retranslation', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const standard = succeededResult();
    const deepRunning: TranslationResult = {
      ...createResult('running'), id: 21, translationVariant: 'deep',
    };
    const deepCompleted: TranslationResult = {
      ...succeededResult(), id: deepRunning.id, translationVariant: 'deep',
      segments: succeededResult().segments.map((segment) => ({
        ...segment, translatedHtml: '<p>Deep translation.</p>', translatedText: 'Deep translation.',
      })),
    };
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      data: { runId: deepRunning.id, reused: false, result: deepRunning, activeResult: standard },
    });
    let eventListener: ((event: TranslationStreamEvent) => void) | undefined;
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: { translation: {
        get: vi.fn().mockResolvedValue({ ok: true, data: { state: 'succeeded', result: standard } }),
        generate,
        prioritize: vi.fn().mockResolvedValue({ ok: true, data: { accepted: true } }),
        onEvent: vi.fn((listener: (event: TranslationStreamEvent) => void) => {
          eventListener = listener;
          return () => undefined;
        }),
      } } as unknown as typeof window.shaleAPI,
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const panelRef = createRef<TranslationPanelHandle>();
    await act(async () => {
      root.render(createElement(TranslationPanel, {
        ref: panelRef, entryId: standard.entryId, isContentReady: true,
        sourceLanguage: standard.sourceLanguage, targetLanguage: standard.targetLanguage,
        useTerminology: false, useSmartContext: false, translationMode: 'deep',
        expertId: standard.expertId,
        shortcut: { key: 'T', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
        sourceHtml: '<h2>Title</h2><p>First</p><p>Second</p><p>Third</p>', titleTarget: null,
        isBilingualVisible: true, onContentClick: vi.fn(), onGeneratingChange: vi.fn(),
        onBilingualChange: vi.fn(), onTitleTranslatingChange: vi.fn(),
        children: createElement('p', undefined, 'Original article'),
      }));
      await settle();
    });
    expect(container.textContent).toContain('First translated');

    await act(async () => {
      await expect(panelRef.current?.requestRetranslation()).resolves.toBe('started');
      await settle();
    });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      translationMode: 'deep', forceNew: true,
    }));
    expect(container.textContent).toContain('First translated');

    await act(async () => {
      eventListener?.({
        type: 'completed', runId: deepRunning.id, entryId: standard.entryId,
        sourceLanguage: standard.sourceLanguage, targetLanguage: standard.targetLanguage,
        result: deepCompleted,
      });
      await settle();
    });
    expect(container.textContent).toContain('Deep translation.');
    act(() => root.unmount());
    container.remove();
  });
});
