// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPMLDialog } from '../../../src/renderer/features/feeds/OPMLDialog';
import type { OPMLImportResult } from '../../../src/shared/contracts/feed.ipc';

const importResult: OPMLImportResult = {
  successCount: 4,
  skipCount: 2,
  failures: [
    {
      title: '失效的订阅',
      xmlUrl: 'https://example.com/invalid.xml',
      error: '无法读取',
    },
  ],
  totalFound: 7,
};

const findButton = (
  container: ParentNode,
  label: string,
): HTMLButtonElement | undefined => (
  [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === label)
);

describe('OPML import and export dialog', () => {
  let root: Root;
  let page: HTMLDivElement;
  let openFile: ReturnType<typeof vi.fn>;
  let saveFile: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    page = document.createElement('div');
    page.className = 'reader-page';
    document.body.append(page);
    root = createRoot(page);
    openFile = vi.fn(async () => ({
      canceled: false,
      filePaths: ['C:\\Subscriptions\\reader.opml'],
    }));
    saveFile = vi.fn(async () => ({
      canceled: false,
      filePath: 'C:\\Subscriptions\\backup.opml',
    }));
    vi.stubGlobal('shaleAPI', {
      dialog: {
        openFile,
        saveFile,
      },
    } as unknown as typeof window.shaleAPI);
  });

  afterEach(() => {
    act(() => root.unmount());
    page.remove();
    vi.unstubAllGlobals();
  });

  it('presents the migration choices in the reader visual hierarchy', async () => {
    await act(async () => {
      root.render(createElement(OPMLDialog, {
        onImport: vi.fn(async () => importResult),
        onExport: vi.fn(async () => undefined),
        onClose: vi.fn(),
      }));
    });

    const dialog = page.querySelector<HTMLElement>('[role="dialog"]');
    const merge = page.querySelector<HTMLInputElement>(
      'input[name="opml-import-mode"][value="merge"]',
    );
    const replace = page.querySelector<HTMLInputElement>(
      'input[name="opml-import-mode"][value="replace"]',
    );

    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.textContent).toContain('导入 / 导出 OPML');
    expect(dialog?.textContent).toContain('从其他阅读器迁移订阅');
    expect(dialog?.textContent).toContain('合并');
    expect(dialog?.textContent).toContain('推荐');
    expect(dialog?.textContent).toContain('替换');
    expect(merge?.checked).toBe(true);
    expect(replace?.checked).toBe(false);
    expect(document.activeElement?.textContent).toContain('选择 OPML 文件');
  });

  it('imports with the selected mode and reports skipped and failed feeds', async () => {
    const onImport = vi.fn(async () => importResult);

    await act(async () => {
      root.render(createElement(OPMLDialog, {
        onImport,
        onExport: vi.fn(async () => undefined),
        onClose: vi.fn(),
      }));
    });

    const replace = page.querySelector<HTMLInputElement>(
      'input[name="opml-import-mode"][value="replace"]',
    );
    act(() => replace?.click());

    expect(page.textContent).toContain('请确认已备份');

    await act(async () => {
      findButton(page, '选择 OPML 文件')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(openFile).toHaveBeenCalledWith(expect.objectContaining({
      title: '选择要导入的 OPML 文件',
    }));
    expect(onImport).toHaveBeenCalledWith(
      'C:\\Subscriptions\\reader.opml',
      'replace',
    );
    expect(page.textContent).toContain('导入完成');
    expect(page.textContent).toContain('已加入 4 个订阅');
    expect(page.textContent).toContain('跳过 2 个重复项');
    expect(page.textContent).toContain('1 个失败');
    expect(page.textContent).toContain('失效的订阅：无法读取');
  });

  it('keeps a keyboard escape route when no file operation is running', async () => {
    const onClose = vi.fn();

    await act(async () => {
      root.render(createElement(OPMLDialog, {
        onImport: vi.fn(async () => importResult),
        onExport: vi.fn(async () => undefined),
        onClose,
      }));
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(openFile).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
  });
});
