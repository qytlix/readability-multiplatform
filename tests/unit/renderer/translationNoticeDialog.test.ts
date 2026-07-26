// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslationNoticeDialog } from '../../../src/renderer/features/translation/TranslationNoticeDialog';

describe('TranslationNoticeDialog', () => {
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

  it('uses the scoped confirmation action for a retranslation notice', async () => {
    const onConfirm = vi.fn();
    await act(async () => {
      root.render(createElement(TranslationNoticeDialog, {
        message: '当前文章还没有翻译',
        onConfirm,
      }));
    });

    const confirmButton = container.querySelector<HTMLButtonElement>(
      '.translation-notice-dialog .translation-notice-confirm[type="submit"]',
    );
    expect(confirmButton?.textContent).toBe('确认');
    await act(async () => {
      confirmButton?.click();
    });
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
