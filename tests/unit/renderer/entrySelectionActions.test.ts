// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntrySelectionActions } from '../../../src/renderer/features/feeds/EntrySelectionActions';

describe('EntrySelectionActions', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onChanged: ReturnType<typeof vi.fn<
    (change: 'read' | 'starred' | 'tags') => Promise<void>
  >>;
  let markRead: ReturnType<typeof vi.fn>;
  let markStarred: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    markRead = vi.fn().mockResolvedValue({ ok: true, data: undefined });
    markStarred = vi.fn().mockResolvedValue({ ok: true, data: undefined });
    onChanged = vi.fn<
      (change: 'read' | 'starred' | 'tags') => Promise<void>
    >().mockResolvedValue(undefined);
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        entry: { markRead, markStarred },
        tag: {
          listByEntries: vi.fn().mockResolvedValue({
            ok: true,
            data: [{ id: 7, name: 'Research', color: '#789' }],
          }),
          tagEntries: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
          untagEntries: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
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

  it('marks and stars all selected entries', async () => {
    await act(async () => {
      root.render(createElement(EntrySelectionActions, {
        selectedIds: new Set([11, 12]),
        onChanged,
        onFeedback: vi.fn(),
        onExport: vi.fn(),
      }));
    });

    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')];
    await act(async () => buttons.find((button) => button.textContent === '标为已读')?.click());
    await act(async () => buttons.find((button) => button.textContent === '收藏')?.click());

    expect(markRead).toHaveBeenCalledWith([11, 12], true);
    expect(markStarred).toHaveBeenCalledWith([11, 12], true);
    expect(onChanged).toHaveBeenNthCalledWith(1, 'read');
    expect(onChanged).toHaveBeenNthCalledWith(2, 'starred');
  });

  it('adds a tag to all selected entries', async () => {
    await act(async () => {
      root.render(createElement(EntrySelectionActions, {
        selectedIds: new Set([11, 12]),
        onChanged,
        onFeedback: vi.fn(),
        onExport: vi.fn(),
      }));
    });
    act(() => [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '添加标签')?.click());

    const input = document.querySelector<HTMLInputElement>('.selection-tag-field input');
    expect(input).not.toBeNull();
    await act(async () => {
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, 'Work');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => document.querySelector<HTMLButtonElement>(
      '.selection-tag-dialog button[type="submit"]',
    )?.click());

    expect(window.shaleAPI.tag.tagEntries).toHaveBeenCalledWith([11, 12], 'Work');
  });

  it('removes a tag from the selected entry union', async () => {
    await act(async () => {
      root.render(createElement(EntrySelectionActions, {
        selectedIds: new Set([11, 12]),
        onChanged,
        onFeedback: vi.fn(),
        onExport: vi.fn(),
      }));
    });
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '移除标签')?.click());
    await act(async () => document.querySelector<HTMLButtonElement>(
      '.selection-tag-list button',
    )?.click());

    expect(window.shaleAPI.tag.listByEntries).toHaveBeenCalledWith([11, 12]);
    expect(window.shaleAPI.tag.untagEntries).toHaveBeenCalledWith([11, 12], 7);
  });
});
