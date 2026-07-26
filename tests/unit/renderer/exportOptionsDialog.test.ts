// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportOptionsDialog } from '../../../src/renderer/features/feeds/ExportOptionsDialog';
import type { ArticleAvailability } from '../../../src/shared/contracts/export.types';

const unavailableArticle: ArticleAvailability = {
  entryId: 17,
  title: 'Article without AI results',
  pipelineStatus: 'success',
  hasSummary: false,
  hasTranslation: false,
  hasNotes: false,
};

describe('ExportOptionsDialog availability feedback', () => {
  let page: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    page = document.createElement('div');
    page.className = 'reader-page';
    document.body.append(page);
    root = createRoot(page);
  });

  afterEach(() => {
    act(() => root.unmount());
    page.remove();
    vi.useRealTimers();
  });

  it('explains why an unavailable option cannot be selected', async () => {
    await act(async () => {
      root.render(createElement(ExportOptionsDialog, {
        open: true,
        articles: [unavailableArticle],
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }));
    });

    const summary = page.querySelector<HTMLInputElement>(
      'input[aria-label="总结不可选：暂无总结"]',
    );
    expect(summary).not.toBeNull();
    expect(summary?.disabled).toBe(false);
    expect(summary?.getAttribute('aria-disabled')).toBe('true');

    act(() => summary?.click());

    expect(summary?.checked).toBe(false);
    expect(page.querySelector('.export-options-feedback')?.textContent)
      .toBe('“Article without AI results”暂无总结，无法选择。');

    act(() => vi.advanceTimersByTime(2600));

    expect(page.querySelector('.export-options-feedback')).toBeNull();
  });
});
