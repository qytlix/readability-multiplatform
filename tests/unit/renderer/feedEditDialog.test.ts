// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedEditDialog } from '../../../src/renderer/features/feeds/FeedEditDialog';
import type { Feed } from '../../../src/shared/contracts/feed.types';

const feed: Feed = {
  id: 7,
  title: 'Example Feed',
  feedURL: 'https://example.com/feed.xml',
  siteURL: 'https://example.com',
  lastSyncStatus: 'success',
  syncIntervalMin: 30,
  createdAt: '2026-07-24T00:00:00.000Z',
};

describe('feed edit dialog', () => {
  let root: Root;
  let page: HTMLDivElement;
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    page = document.createElement('div');
    page.className = 'reader-page';
    document.body.append(page);
    root = createRoot(page);
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    page.remove();
    vi.useRealTimers();
  });

  it('copies the title and Site URL with a temporary success check', async () => {
    vi.useFakeTimers();

    await act(async () => {
      root.render(createElement(
        'div',
        { className: 'reader-sidebar' },
        createElement(FeedEditDialog, {
          feed,
          onSave: vi.fn(async () => undefined),
          onClose: vi.fn(),
        }),
      ));
    });

    const dialog = page.querySelector<HTMLElement>('[role="dialog"]');
    const overlay = dialog?.closest<HTMLElement>('.dialog-overlay');
    const titleCopy = page.querySelector<HTMLButtonElement>('[aria-label="Copy title"]');
    const siteURLCopy = page.querySelector<HTMLButtonElement>(
      '[aria-label="Copy Site URL"]',
    );

    expect(dialog?.classList.contains('feed-edit-dialog')).toBe(true);
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(overlay?.parentElement).toBe(page);
    expect(page.querySelector('.reader-sidebar .dialog-overlay')).toBeNull();

    await act(async () => {
      titleCopy?.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(feed.title);
    expect(titleCopy?.classList.contains('is-copied')).toBe(true);
    expect(titleCopy?.getAttribute('aria-label')).toBe('Title copied');
    expect(titleCopy?.disabled).toBe(true);

    act(() => vi.advanceTimersByTime(2800));

    expect(titleCopy?.classList.contains('is-copied')).toBe(false);
    expect(titleCopy?.getAttribute('aria-label')).toBe('Copy title');

    await act(async () => {
      siteURLCopy?.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenLastCalledWith(feed.siteURL);
    expect(siteURLCopy?.classList.contains('is-copied')).toBe(true);
    expect(siteURLCopy?.getAttribute('aria-label')).toBe('Site URL copied');
  });

  it('keeps edit labels prominent and day-mode input text dark', () => {
    const css = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../src/renderer/features/reader/ReaderPage.css',
      ),
      'utf8',
    );

    expect(css).toMatch(
      /\.feed-edit-dialog \.form-group label \{[^}]*font-size: 14px;[^}]*font-weight: 650;/,
    );
    expect(css).toMatch(
      /\.reader-page\[data-theme="light"\] \.feed-edit-dialog \.form-group input \{[^}]*color: #111;/,
    );
    expect(css).toMatch(
      /\.reader-page\[data-theme="light"\] \.feed-edit-dialog \.dialog-actions button\[type="submit"\] \{[^}]*color: var\(--reader-accent-ink\);/,
    );
  });
});
