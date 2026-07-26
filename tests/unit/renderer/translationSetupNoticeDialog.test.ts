// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslationSetupNoticeDialog } from '../../../src/renderer/features/translation/TranslationSetupNoticeDialog';

describe('TranslationSetupNoticeDialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    container.className = 'reader-page';
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('requires the only confirmation action and does not close through Escape or the overlay', async () => {
    const onConfirm = vi.fn();
    await act(async () => {
      root.render(createElement(TranslationSetupNoticeDialog, {
        open: true,
        onConfirm,
      }));
    });

    const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(dialog?.textContent).toContain('翻译设置提示');
    expect(dialog?.textContent)
      .toContain('你可以点击左下角的「设置」，前往设置页选择术语库和 AI 翻译专家。');
    expect(dialog?.querySelectorAll('button')).toHaveLength(1);

    await act(async () => {
      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      container.querySelector<HTMLElement>('.translation-setup-notice-overlay')?.click();
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();

    await act(async () => {
      dialog?.querySelector('button')?.click();
    });
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
