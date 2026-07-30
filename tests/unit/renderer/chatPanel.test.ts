import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '../../../src/renderer/features/chat/ChatPanel';
import type { ChatStreamEvent } from '../../../src/shared/contracts/chat.types';

let dom: JSDOM | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  dom?.window.close();
  dom = null;
  vi.unstubAllGlobals();
});

describe('ChatPanel', () => {
  it('loads persisted messages and applies the completed stream event', async () => {
    dom = new JSDOM('<div id="app"></div>', {
      url: 'https://reader.example.test',
    });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let listener: ((event: ChatStreamEvent) => void) | undefined;
    const unsubscribe = vi.fn();
    Object.defineProperty(dom.window, 'shaleAPI', {
      value: {
        chat: {
          get: vi.fn(async () => ({
            ok: true as const,
            data: {
              entryId: 1,
              threadId: 2,
              messages: [
                {
                  id: 10,
                  threadId: 2,
                  role: 'user' as const,
                  content: '核心观点是什么？',
                  status: 'succeeded' as const,
                  createdAt: 'created',
                  updatedAt: 'updated',
                },
                {
                  id: 11,
                  threadId: 2,
                  role: 'assistant' as const,
                  content: '正在',
                  status: 'streaming' as const,
                  createdAt: 'created',
                  updatedAt: 'updated',
                },
              ],
              activeRun: {
                id: 3,
                threadId: 2,
                entryId: 1,
                userMessageId: 10,
                assistantMessageId: 11,
                status: 'running' as const,
                createdAt: 'created',
              },
            },
          })),
          send: vi.fn(),
          cancel: vi.fn(),
          clear: vi.fn(),
          onEvent: (nextListener: (event: ChatStreamEvent) => void) => {
            listener = nextListener;
            return unsubscribe;
          },
        },
      },
    });
    const mount = dom.window.document.querySelector<HTMLElement>('#app');
    if (!mount) throw new Error('Missing ChatPanel test mount.');
    root = createRoot(mount);

    await act(async () => {
      root?.render(createElement(ChatPanel, {
        entryId: 1,
        isContentReady: true,
        isVisible: true,
        onVisibleChange: vi.fn(),
      }));
    });

    expect(mount.textContent).toContain('核心观点是什么？');
    expect(mount.textContent).toContain('正在');
    expect(mount.textContent).toContain('停止');

    await act(async () => {
      listener?.({
        type: 'completed',
        runId: 3,
        threadId: 2,
        entryId: 1,
        messageId: 11,
        message: {
          id: 11,
          threadId: 2,
          role: 'assistant',
          content: '文章主张减少云端依赖。',
          status: 'succeeded',
          createdAt: 'created',
          updatedAt: 'completed',
        },
      });
    });

    expect(mount.textContent).toContain('文章主张减少云端依赖。');
    expect(mount.textContent).toContain('发送');
  });
});
