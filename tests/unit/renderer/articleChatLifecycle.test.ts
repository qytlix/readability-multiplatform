// @vitest-environment jsdom

import {
  act,
  createElement,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatState } from '../../../src/shared/contracts/chat.types';
import {
  useArticleChatSession,
  type ArticleChatSession,
} from '../../../src/renderer/features/chat/useArticleChatSession';
import { ChatImageAttachmentPreview } from '../../../src/renderer/features/chat/ChatImageAttachmentPreview';

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const idleState: ChatState = {
  state: 'idle',
  thread: {
    id: 3,
    entryId: 7,
    sourceContentHash: 'hash',
    contextPromptVersion: 'article-chat-v1',
    active: true,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  },
  messages: [],
  draftAttachments: [],
};

const failedState: ChatState = {
  state: 'failed',
  thread: idleState.thread,
  draftAttachments: [],
  messages: [{
    id: 10,
    threadId: 3,
    role: 'user',
    content: 'Explain the full article.',
    status: 'completed',
    articleContextMode: 'article-map',
    articleContentHash: 'hash',
    attachments: [],
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  }, {
    id: 11,
    threadId: 3,
    role: 'assistant',
    content: '',
    status: 'failed',
    articleContextMode: 'article-map',
    articleContentHash: 'hash',
    attachments: [],
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  }],
  run: {
    id: 12,
    threadId: 3,
    userMessageId: 10,
    assistantMessageId: 11,
    providerProfileId: 2,
    providerKind: 'openai',
    model: 'chat-model',
    status: 'failed',
    promptVersion: 'article-chat-v1',
    contextMode: 'article-map',
    inputContentHash: 'reserved-input',
    error: {
      code: 'CHAT_CONTEXT_TOO_LARGE',
      message: 'The required context does not fit.',
      retryable: false,
    },
    createdAt: '2026-07-30T00:00:00.000Z',
    completedAt: '2026-07-30T00:00:01.000Z',
  },
};

const SessionHarness = ({
  children,
  onSession,
}: {
  children?: ReactNode;
  onSession?: (session: ArticleChatSession) => void;
}) => {
  const session = useArticleChatSession(7, true);
  onSession?.(session);
  return children ?? null;
};

describe('Article Chat renderer lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root;
  let removeListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    removeListener = vi.fn();
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        chat: {
          get: vi.fn().mockResolvedValue({ ok: true, data: idleState }),
          send: vi.fn(),
          cancel: vi.fn(),
          retry: vi.fn(),
          previewAttachment: vi.fn().mockResolvedValue({
            ok: true,
            data: {
              mimeType: 'image/png',
              bytes: Uint8Array.from([1, 2, 3]),
              width: 20,
              height: 10,
            },
          }),
          onEvent: vi.fn(() => removeListener),
        },
        provider: {
          get: vi.fn().mockResolvedValue({ ok: true, data: null }),
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

  it('removes its stream listener when the panel unmounts', async () => {
    await act(async () => {
      root.render(createElement(SessionHarness));
      await settle();
    });

    expect(window.shaleAPI.chat.onEvent).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    expect(removeListener).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });

  it('reloads a durable failed run after send preparation fails', async () => {
    vi.mocked(window.shaleAPI.chat.get)
      .mockResolvedValueOnce({ ok: true, data: idleState })
      .mockResolvedValueOnce({ ok: true, data: failedState });
    vi.mocked(window.shaleAPI.chat.send).mockResolvedValue({
      ok: false,
      error: {
        code: 'CHAT_CONTEXT_TOO_LARGE',
        message: 'The required context does not fit.',
        retryable: false,
      },
    });
    let session: ArticleChatSession | undefined;
    await act(async () => {
      root.render(createElement(SessionHarness, {
        onSession: (current) => {
          session = current;
        },
      }));
      await settle();
    });

    let sent = true;
    await act(async () => {
      sent = await session?.sendQuestion('Explain the full article.') ?? true;
      await settle();
    });

    expect(sent).toBe(false);
    expect(window.shaleAPI.chat.get).toHaveBeenCalledTimes(2);
    expect(session?.state).toEqual(failedState);
    expect(session?.actionErrorMessage).toBe(
      'The required context does not fit.',
    );
  });

  it('revokes a normalized image preview URL on unmount', async () => {
    const createObjectUrl = vi.fn(() => 'blob:chat-preview');
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });
    const attachment = {
      id: 8,
      threadId: 3,
      kind: 'image' as const,
      displayName: 'pasted-image.png',
      mimeType: 'image/png',
      byteSize: 3,
      contentHash: 'hash',
      width: 20,
      height: 10,
      createdAt: '2026-07-30T00:00:00.000Z',
    };

    await act(async () => {
      root.render(createElement(ChatImageAttachmentPreview, {
        entryId: 7,
        attachment,
      }));
      await settle();
    });
    expect(container.querySelector('img')?.getAttribute('src'))
      .toBe('blob:chat-preview');

    act(() => root.unmount());
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:chat-preview');
    root = createRoot(container);
    vi.unstubAllGlobals();
  });
});

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
