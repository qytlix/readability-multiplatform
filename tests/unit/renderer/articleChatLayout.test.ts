import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createArticleChatLayoutSnapshot,
  restoreReaderColumnState,
} from '../../../src/renderer/features/chat/articleChatLayout';

describe('Article Chat layout snapshots', () => {
  it.each([
    {
      label: 'sidebar and entry list visible',
      sidebarOpen: true,
      readingFocus: false,
    },
    {
      label: 'sidebar hidden and entry list visible',
      sidebarOpen: false,
      readingFocus: false,
    },
    {
      label: 'sidebar visible and entry list hidden',
      sidebarOpen: true,
      readingFocus: true,
    },
    {
      label: 'sidebar and entry list hidden',
      sidebarOpen: false,
      readingFocus: true,
    },
  ])('restores $label without changing the custom width', ({
    sidebarOpen,
    readingFocus,
  }) => {
    const original = {
      sidebarOpen,
      readingFocus,
      storyListWidth: 517,
    };

    expect(
      restoreReaderColumnState(createArticleChatLayoutSnapshot(original)),
    ).toEqual(original);
  });

  it('normalizes an invalid measured width without changing collapse state', () => {
    expect(createArticleChatLayoutSnapshot({
      sidebarOpen: false,
      readingFocus: true,
      storyListWidth: Number.NaN,
    })).toEqual({
      sidebarOpen: false,
      entryListCollapsed: true,
      entryListWidth: 0,
    });
  });

  it('places chat and article side by side without auto-placement', () => {
    const css = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../src/renderer/features/reader/ReaderPage.css',
      ),
      'utf8',
    ).replace(/\r\n/g, '\n');

    const workspaceRule = css.match(
      /\.reader-page\.is-article-chat \.reader-workspace\s*\{([^}]*)\}/s,
    )?.[1];
    const articleRule = css.match(
      /\.reader-page\.is-article-chat \.article-pane\s*\{([^}]*)\}/s,
    )?.[1];

    expect(workspaceRule).toContain(
      'var(--reader-sidebar-width)\n'
      + '      + var(--reader-list-width)\n'
      + '      + var(--reader-divider-width)',
    );
    expect(workspaceRule).toContain('minmax(0, 1fr)');
    expect(articleRule).toContain('grid-column: 2;');
    expect(articleRule).toContain('grid-row: 1;');
    expect(css).toContain(
      '.reader-page.is-article-chat .reader-sidebar,\n'
      + '.reader-page.is-article-chat .story-list-pane,\n'
      + '.reader-page.is-article-chat .reader-list-divider,\n'
      + '.reader-page.is-article-chat .sidebar-backdrop {\n'
      + '  display: none;',
    );
  });
});
