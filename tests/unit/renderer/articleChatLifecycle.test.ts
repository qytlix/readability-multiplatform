// @vitest-environment jsdom

import {
  act,
  createElement,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatState } from '../../../src/shared/contracts/chat.types';
import { useArticleChatSession } from '../../../src/renderer/features/chat/useArticleChatSession';

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
};

const SessionHarness = ({ children }: { children?: ReactNode }) => {
  useArticleChatSession(7, true);
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
});

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
