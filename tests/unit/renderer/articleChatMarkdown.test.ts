// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatState } from '../../../src/shared/contracts/chat.types';
import type { ArticleChatSession } from '../../../src/renderer/features/chat/useArticleChatSession';

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const sessionRef = vi.hoisted(() => ({
  current: null as ArticleChatSession | null,
}));

vi.mock(
  '../../../src/renderer/features/chat/useArticleChatSession',
  () => ({
    useArticleChatSession: () => sessionRef.current,
  }),
);

import { ArticleChatPanel } from '../../../src/renderer/features/chat/ArticleChatPanel';

const markdownAnswer = [
  '## 核心结论',
  '',
  '这是 **重要内容**，并包含：',
  '',
  '- 第一项',
  '- 第二项',
  '',
  '```ts',
  'const answer = 42;',
  '```',
  '',
  '| 名称 | 值 |',
  '| --- | ---: |',
  '| answer | 42 |',
  '',
  '[参考资料](https://example.com/reference)',
  '',
  '<script>window.compromised = true</script>',
  '',
  '![远程跟踪图片](https://example.com/tracker.png)',
].join('\n');

const chatState: ChatState = {
  state: 'idle',
  thread: {
    id: 3,
    entryId: 7,
    sourceContentHash: 'article-hash',
    contextPromptVersion: 'article-chat-v1',
    active: true,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  },
  messages: [{
    id: 11,
    threadId: 3,
    role: 'assistant',
    content: markdownAnswer,
    status: 'completed',
    articleContextMode: 'full',
    articleContentHash: 'article-hash',
    attachments: [],
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  }],
  draftAttachments: [],
};

const resolveFalse = async (): Promise<boolean> => false;
const resolveVoid = async (): Promise<void> => undefined;

describe('Article Chat Markdown rendering', () => {
  let container: HTMLDivElement;
  let root: Root;
  let externalOpen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    externalOpen = vi.fn().mockResolvedValue({
      ok: true,
      data: undefined,
    });
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        external: {
          open: externalOpen,
        },
      } as unknown as typeof window.shaleAPI,
    });
    sessionRef.current = {
      loadStatus: 'success',
      state: chatState,
      provider: null,
      errorMessage: '',
      actionStatus: 'idle',
      actionErrorMessage: '',
      reload: resolveVoid,
      sendQuestion: resolveFalse,
      stop: resolveFalse,
      retry: resolveFalse,
      pickAttachments: resolveFalse,
      removeAttachment: resolveFalse,
      importClipboardImages: resolveFalse,
    };
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    sessionRef.current = null;
    vi.restoreAllMocks();
  });

  it('renders assistant CommonMark and GFM without executing raw HTML', async () => {
    await act(async () => {
      root.render(createElement(ArticleChatPanel, {
        entryId: 7,
        entryTitle: 'Markdown article',
        onClose: () => undefined,
        onActiveRunChange: () => undefined,
        onSelectionCleared: () => undefined,
      }));
    });

    const answer = container.querySelector(
      '[data-message-id="11"] .article-chat-message-content',
    );

    expect(answer?.querySelector('h2')?.textContent).toBe('核心结论');
    expect(answer?.querySelector('strong')?.textContent).toBe('重要内容');
    expect(answer?.querySelectorAll('li')).toHaveLength(2);
    expect(answer?.querySelector('pre code')?.textContent)
      .toContain('const answer = 42;');
    expect(answer?.querySelector('table')).not.toBeNull();
    expect(answer?.querySelector('a')?.getAttribute('href'))
      .toBe('https://example.com/reference');
    expect(answer?.querySelector('script')).toBeNull();
    expect(answer?.querySelector('img')).toBeNull();
    expect(answer?.textContent).toContain(
      '<script>window.compromised = true</script>',
    );
  });

  it('opens rendered links through the restricted external-link API', async () => {
    await act(async () => {
      root.render(createElement(ArticleChatPanel, {
        entryId: 7,
        entryTitle: 'Markdown article',
        onClose: () => undefined,
        onActiveRunChange: () => undefined,
        onSelectionCleared: () => undefined,
      }));
    });

    const link = container.querySelector<HTMLAnchorElement>(
      '[data-message-id="11"] a',
    );
    expect(link).not.toBeNull();

    const click = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    act(() => {
      link?.dispatchEvent(click);
    });

    expect(click.defaultPrevented).toBe(true);
    expect(externalOpen).toHaveBeenCalledWith({
      url: 'https://example.com/reference',
    });
  });
});
