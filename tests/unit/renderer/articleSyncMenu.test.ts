// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArticleSyncMenu } from '../../../src/renderer/features/reader/ArticleSyncMenu';

describe('ArticleSyncMenu', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('keeps both article operations available through focus and keyboard navigation', async () => {
    const onRefreshArticle = vi.fn();
    const onRetranslateArticle = vi.fn();
    await act(async () => {
      root.render(createElement(ArticleSyncMenu, {
        hasEntry: true,
        isRefreshing: false,
        onRefreshArticle,
        onRetranslateArticle,
      }));
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="文章同步操作"]',
    );
    await act(async () => {
      trigger?.focus();
      await Promise.resolve();
    });

    const menu = container.querySelector<HTMLElement>('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
    expect(menu?.textContent).toContain('重新拉取文章');
    expect(menu?.textContent).toContain('重新翻译');

    await act(async () => {
      trigger?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
      }));
      await Promise.resolve();
    });
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');

    const retranslate = Array.from(menu?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    ) ?? []).find((item) => item.textContent === '重新翻译');
    await act(async () => {
      retranslate?.click();
      await Promise.resolve();
    });
    expect(onRetranslateArticle).toHaveBeenCalledOnce();
    expect(onRefreshArticle).not.toHaveBeenCalled();
  });
});
