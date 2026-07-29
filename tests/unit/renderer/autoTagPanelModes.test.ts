// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoTagPanel } from '../../../src/renderer/features/tags/AutoTagPanel';

describe('AutoTagPanel modes', () => {
  let container: HTMLDivElement;
  let root: Root;
  let autoTagGenerate: ReturnType<typeof vi.fn>;
  let autoTagConfirm: ReturnType<typeof vi.fn>;

  const flush = async (): Promise<void> => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    autoTagGenerate = vi.fn().mockResolvedValue({
      ok: true,
      data: [
        { name: 'AI', source: 'generated' },
        { name: 'Research', source: 'matched', tagId: 4 },
      ],
    });
    autoTagConfirm = vi.fn().mockResolvedValue({
      ok: true,
      data: [
        { id: 8, name: 'AI', color: '#789' },
        { id: 4, name: 'Research', color: '#987' },
      ],
    });
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        tag: {
          autoTagGenerate,
          autoTagConfirm,
          autoTagCheckStatus: vi.fn().mockResolvedValue({
            ok: true,
            data: { aiTagGenerated: false },
          }),
          autoTagClearStatus: vi.fn().mockResolvedValue({
            ok: true,
            data: undefined,
          }),
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
  });

  it('shows candidates when automatic triggering uses manual confirmation', async () => {
    await act(async () => {
      root.render(createElement(AutoTagPanel, {
        entryId: 701,
        autoTrigger: true,
        confirmMode: 'manual',
      }));
    });
    await flush();

    expect(autoTagGenerate).toHaveBeenCalledWith({
      entryId: 701,
      maxCandidates: 8,
    });
    expect(autoTagConfirm).not.toHaveBeenCalled();
    expect(container.textContent).toContain('确认添加 (2)');
  });

  it('persists every candidate when confirmation is automatic', async () => {
    const onTagsChanged = vi.fn();
    const onAutoConfirmed = vi.fn();
    await act(async () => {
      root.render(createElement(AutoTagPanel, {
        entryId: 702,
        autoTrigger: true,
        confirmMode: 'auto',
        onTagsChanged,
        onAutoConfirmed,
      }));
    });
    await flush();

    expect(autoTagConfirm).toHaveBeenCalledWith({
      entryId: 702,
      tagNames: ['AI', 'Research'],
    });
    expect(onTagsChanged).toHaveBeenCalledTimes(1);
    expect(onAutoConfirmed).toHaveBeenCalledWith(2);
    expect(container.textContent).toContain('已生成');
  });

  it('also honors automatic confirmation after a manual trigger', async () => {
    await act(async () => {
      root.render(createElement(AutoTagPanel, {
        entryId: 703,
        autoTrigger: false,
        confirmMode: 'auto',
      }));
    });
    await flush();
    const generateButton = container.querySelector<HTMLButtonElement>(
      '.auto-tag-trigger-pill',
    );
    await act(async () => generateButton?.click());
    await flush();

    expect(autoTagConfirm).toHaveBeenCalledWith({
      entryId: 703,
      tagNames: ['AI', 'Research'],
    });
  });
});
