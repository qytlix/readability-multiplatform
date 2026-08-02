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
  () => ({ useArticleChatSession: () => sessionRef.current }),
);

import { ArticleChatPanel } from '../../../src/renderer/features/chat/ArticleChatPanel';

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
    id: 10,
    threadId: 3,
    role: 'user',
    content: 'Original question',
    status: 'completed',
    articleContextMode: 'full',
    articleContentHash: 'article-hash',
    attachments: [],
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  }, {
    id: 11,
    threadId: 3,
    role: 'assistant',
    content: 'Model answer',
    status: 'completed',
    articleContextMode: 'full',
    articleContentHash: 'article-hash',
    attachments: [],
    createdAt: '2026-07-31T00:00:01.000Z',
    updatedAt: '2026-07-31T00:00:01.000Z',
  }],
  draftAttachments: [],
};

const resolveFalse = async (): Promise<boolean> => false;
const resolveVoid = async (): Promise<void> => undefined;

describe('Article Chat message actions', () => {
  let container: HTMLDivElement;
  let root: Root;
  let regenerate: ReturnType<typeof createRegenerateMock>;
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    regenerate = createRegenerateMock();
    writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
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
      regenerate,
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

  it('copies both roles using their persisted plain content', async () => {
    await renderPanel(root);
    const copyButtons = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="复制消息"]',
    );
    expect(copyButtons).toHaveLength(2);

    await act(async () => {
      copyButtons[0]?.click();
      await settle();
      copyButtons[1]?.click();
      await settle();
    });

    expect(writeText).toHaveBeenNthCalledWith(1, 'Original question');
    expect(writeText).toHaveBeenNthCalledWith(2, 'Model answer');
  });

  it('edits a user turn inline and regenerates from the matching answer', async () => {
    await renderPanel(root);
    const editButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="编辑问题"]',
    );
    act(() => editButton?.click());
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="编辑问题"]',
    );
    expect(textarea?.value).toBe('Original question');

    act(() => {
      setTextareaValue(textarea, 'Edited question');
    });
    const sendButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '.article-chat-message-editor-actions button',
      ),
    ).find((button) => button.textContent === '发送');
    await act(async () => {
      sendButton?.click();
      await settle();
    });
    expect(regenerate).toHaveBeenCalledWith(10, 'Edited question');

    const regenerateButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="重新回答"]',
    );
    await act(async () => {
      regenerateButton?.click();
      await settle();
    });
    expect(regenerate).toHaveBeenLastCalledWith(10);
  });

});

async function renderPanel(root: Root): Promise<void> {
  await act(async () => {
    root.render(createElement(ArticleChatPanel, {
      entryId: 7,
      entryTitle: 'Article',
      onClose: vi.fn(),
      onSelectionCleared: vi.fn(),
    }));
    await settle();
  });
}

function createRegenerateMock() {
  return vi.fn(async (
    _userMessageId: number,
    _question?: string,
  ): Promise<boolean> => {
    void _userMessageId;
    void _question;
    return true;
  });
}

function setTextareaValue(
  textarea: HTMLTextAreaElement | null,
  value: string,
): void {
  if (!textarea) throw new Error('Expected the inline edit textarea.');
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
