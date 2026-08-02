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
      availableChatModels: [],
      chatModelCatalogStatus: 'idle',
      chatModelCatalogErrorMessage: '',
      errorMessage: '',
      actionStatus: 'idle',
      actionErrorMessage: '',
      reload: resolveVoid,
      sendQuestion: resolveFalse,
      stop: resolveFalse,
      retry: resolveFalse,
      regenerate: resolveFalse,
      loadChatModels: resolveFalse,
      switchChatModel: resolveFalse,
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

  it('omits speaker labels while retaining role-specific message containers', async () => {
    if (!sessionRef.current) throw new Error('Expected a chat session');
    sessionRef.current = {
      ...sessionRef.current,
      state: {
        ...chatState,
        messages: [
          {
            ...chatState.messages[0],
            id: 10,
            role: 'user',
            content: '请解释核心结论',
          },
          ...chatState.messages,
        ],
      },
    };

    await act(async () => {
      root.render(createElement(ArticleChatPanel, {
        entryId: 7,
        entryTitle: 'Markdown article',
        onClose: () => undefined,
        onSelectionCleared: () => undefined,
      }));
    });

    const userMessage = container.querySelector('[data-message-id="10"]');
    const assistantMessage = container.querySelector('[data-message-id="11"]');

    expect(container.querySelector('.article-chat-message-role')).toBeNull();
    expect(userMessage?.classList.contains('is-user')).toBe(true);
    expect(
      userMessage?.querySelector('.article-chat-message-content')?.textContent,
    ).toBe('请解释核心结论');
    expect(assistantMessage?.classList.contains('is-assistant')).toBe(true);
  });

  it('shows an actionable status for an exhausted Provider outage', async () => {
    if (!sessionRef.current) throw new Error('Expected a chat session');
    sessionRef.current = {
      ...sessionRef.current,
      state: {
        state: 'failed',
        thread: chatState.thread,
        messages: chatState.messages.map((message) => ({
          ...message,
          status: 'failed',
          content: '',
        })),
        draftAttachments: [],
        run: {
          id: 5,
          threadId: chatState.thread.id,
          userMessageId: 9,
          assistantMessageId: 11,
          providerProfileId: 1,
          providerKind: 'custom-openai-compatible',
          model: 'gpt-5',
          status: 'failed',
          promptVersion: 'article-chat-v1',
          contextMode: 'full',
          inputContentHash: 'input-hash',
          error: {
            code: 'CHAT_PROVIDER_REQUEST_FAILED',
            message: 'The provider request failed with status 503.',
            retryable: true,
          },
          createdAt: '2026-07-31T08:55:58.273Z',
          completedAt: '2026-07-31T08:56:04.609Z',
        },
      },
    };

    await act(async () => {
      root.render(createElement(ArticleChatPanel, {
        entryId: 7,
        entryTitle: 'Markdown article',
        onClose: () => undefined,
        onSelectionCleared: () => undefined,
      }));
    });

    expect(
      container.querySelector('.article-chat-retry [role="alert"]')
        ?.textContent,
    ).toContain('HTTP 503');
    expect(container.querySelector('.article-chat-retry')?.textContent)
      .toContain('若持续失败请切换模型');
  });

  it('opens rendered links through the restricted external-link API', async () => {
    await act(async () => {
      root.render(createElement(ArticleChatPanel, {
        entryId: 7,
        entryTitle: 'Markdown article',
        onClose: () => undefined,
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
