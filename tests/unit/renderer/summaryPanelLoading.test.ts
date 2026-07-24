// @vitest-environment jsdom

import {
  act,
  createElement,
  createRef,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SummaryStreamEvent } from '../../../src/shared/contracts/summary.types';
import {
  SummaryPanel,
  type SummaryPanelHandle,
} from '../../../src/renderer/features/summary/SummaryPanel';

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe('SummaryPanel loading feedback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the title and bouncing dots immediately while generating', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    let onSummaryEvent: ((event: SummaryStreamEvent) => void) | undefined;
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        provider: {
          get: vi.fn().mockResolvedValue({
            ok: true,
            data: {
              id: 1,
              providerKind: 'openai-compatible',
              baseUrl: 'https://api.openai.com/v1',
              model: 'gpt-5.4-mini',
              isActive: true,
              hasApiKey: true,
              createdAt: '2026-07-24T00:00:00.000Z',
              updatedAt: '2026-07-24T00:00:00.000Z',
            },
          }),
        },
        summary: {
          get: vi.fn().mockResolvedValue({ ok: true, data: { state: 'idle' } }),
          generate: vi.fn().mockResolvedValue({
            ok: true,
            data: { runId: 7, reused: false },
          }),
          onEvent: vi.fn((listener: (event: SummaryStreamEvent) => void) => {
            onSummaryEvent = listener;
            return () => undefined;
          }),
        },
      } as unknown as typeof window.shaleAPI,
    });

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const panelRef = createRef<SummaryPanelHandle>();

    const Harness = () => {
      const [isVisible, setIsVisible] = useState(false);
      return createElement(SummaryPanel, {
        ref: panelRef,
        entryId: 12,
        isContentReady: true,
        isVisible,
        targetLanguage: 'zh-CN',
        detailLevel: 'medium',
        onGeneratingChange: vi.fn(),
        onVisibleChange: setIsVisible,
      });
    };

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      panelRef.current?.activate();
      await Promise.resolve();
    });

    expect(container.querySelector('.summary-result-title')?.textContent)
      .toBe('AI SUMMARY');
    expect(container.querySelectorAll('.summary-loading-dots span')).toHaveLength(3);

    act(() => {
      onSummaryEvent?.({
        type: 'completed',
        runId: 7,
        entryId: 12,
        targetLanguage: 'zh-CN',
        detailLevel: 'medium',
        result: {
          id: 2,
          runId: 7,
          entryId: 12,
          targetLanguage: 'zh-CN',
          detailLevel: 'medium',
          content: '生成完成',
          inputMarkdownHash: 'hash',
          promptVersion: 'v1',
          createdAt: '2026-07-24T00:00:00.000Z',
          updatedAt: '2026-07-24T00:00:00.000Z',
        },
      });
    });

    expect(container.querySelector('.summary-loading-dots')).toBeNull();
    expect(container.querySelector('.summary-result-content')?.textContent)
      .toBe('生成完成');

    act(() => root.unmount());
    container.remove();
  });
});
