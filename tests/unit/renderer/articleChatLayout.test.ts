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
});
