// @vitest-environment jsdom

import {
  act,
  createElement,
  Fragment,
  forwardRef,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CleanedContent } from '../../../src/shared/contracts/content.types';
import type { Entry } from '../../../src/shared/contracts/feed.types';
import { DEFAULT_AI_PREFERENCES } from '../../../src/renderer/features/settings/aiPreferences';

const { captureTagWindowProps } = vi.hoisted(() => ({
  captureTagWindowProps: vi.fn(),
}));

vi.mock('../../../src/renderer/features/summary/SummaryPanel', () => ({
  SummaryPanel: forwardRef(() => null),
}));

vi.mock('../../../src/renderer/features/translation/TranslationPanel', () => ({
  TranslationPanel: forwardRef<unknown, { children?: ReactNode }>(
    ({ children }) => createElement(Fragment, null, children),
  ),
}));

vi.mock('../../../src/renderer/features/translation/InlineTranslationOverlay', () => ({
  InlineTranslationOverlay: () => null,
}));

vi.mock('../../../src/renderer/features/annotations/AnnotatedArticle', () => ({
  AnnotatedArticle: ({ sourceHtml }: { sourceHtml: string }) =>
    createElement('div', { dangerouslySetInnerHTML: { __html: sourceHtml } }),
}));

vi.mock('../../../src/renderer/features/tags/TagFloatingWindow', () => ({
  TagFloatingWindow: (props: unknown) => {
    captureTagWindowProps(props);
    return null;
  },
}));

import { EntryDetail } from '../../../src/renderer/features/feeds/EntryDetail';

const entry: Entry = {
  id: 810,
  feedId: 3,
  title: 'Auto tag article',
  url: 'https://example.com/auto-tag',
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
  isRead: false,
  readingProgress: 0,
  isStarred: false,
  isDeleted: false,
};

const content: CleanedContent = {
  entryId: entry.id,
  sourceUrl: entry.url ?? '',
  cleanedHtml: '<article>Ready for tagging</article>',
  markdown: 'Ready for tagging',
  pipelineStatus: 'success',
  sourceContentHash: 'tag-hash',
};

describe('EntryDetail automatic tag triggering', () => {
  let container: HTMLDivElement;
  let toolbarTarget: HTMLDivElement;
  let root: Root;
  let listByEntry: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    captureTagWindowProps.mockReset();
    listByEntry = vi.fn().mockResolvedValue({ ok: true, data: [] });
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        content: {
          get: vi.fn().mockResolvedValue({ ok: true, data: content }),
          fetchAndClean: vi.fn(),
        },
        annotation: {
          list: vi.fn().mockResolvedValue({ ok: true, data: [] }),
        },
        tag: { listByEntry },
      } as unknown as typeof window.shaleAPI,
    });
    container = document.createElement('div');
    toolbarTarget = document.createElement('div');
    document.body.append(container);
    document.body.append(toolbarTarget);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    toolbarTarget.remove();
    vi.restoreAllMocks();
  });

  const render = async (triggerMode: 'manual' | 'auto'): Promise<void> => {
    await act(async () => {
      root.render(createElement(EntryDetail, {
        entry,
        aiViewState: { summaryVisible: false, translationVisible: false },
        feedLoadStatus: 'success',
        feedLoadError: '',
        feedCount: 1,
        entryLoadStatus: 'success',
        entryLoadError: '',
        entryCount: 1,
        onAddFeed: vi.fn(),
        onRetryFeeds: vi.fn(),
        onRetryEntries: vi.fn(),
        aiPreferences: {
          ...DEFAULT_AI_PREFERENCES,
          tagAgentTriggerMode: triggerMode,
          tagAgentConfirmMode: 'auto',
        },
        aiToolbarTarget: toolbarTarget,
        onAIViewStateChange: vi.fn(),
        onReadingProgressChange: vi.fn().mockResolvedValue(undefined),
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  it('opens a silent auto-confirm runner for an untagged cleaned article', async () => {
    await render('auto');

    expect(listByEntry).toHaveBeenCalledWith(entry.id);
    expect(captureTagWindowProps).toHaveBeenCalledWith(expect.objectContaining({
      entryId: entry.id,
      autoTrigger: true,
      confirmMode: 'auto',
      silent: true,
    }));
  });

  it('does not trigger while the preference remains manual', async () => {
    await render('manual');

    expect(listByEntry).not.toHaveBeenCalled();
    expect(captureTagWindowProps).not.toHaveBeenCalled();
  });
});
