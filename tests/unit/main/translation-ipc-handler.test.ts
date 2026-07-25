import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { TRANSLATION_IPC_CHANNELS } from '../../../src/shared/contracts/translation.ipc';

const captured = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, request?: unknown) => unknown>(),
  webContents: {
    mainFrame: {},
    send: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, request?: unknown) => unknown,
    ) => {
      captured.handlers.set(channel, handler);
    },
  },
}));

import { registerTranslationIpcHandlers } from '../../../src/main/ipc/translation.handler';
import type { TranslationServices } from '../../../src/main/services';

function register() {
  const translationService = {
    subscribe: vi.fn(() => () => undefined),
    getTerminologyInfo: vi.fn(() => ({ version: 'none', sources: [] })),
    getState: vi.fn(() => ({ state: 'idle' })),
    generate: vi.fn(() => ({
      runId: 31,
      reused: false,
      result: {
        id: 31,
        entryId: 7,
        targetLanguage: 'zh-CN',
        sourceContentHash: 'content-hash',
        segmenterVersion: 'v3',
        terminologyPackVersion: 'none',
        promptVersion: 'translation-v1',
        status: 'running',
        createdAt: '2026-07-25T00:00:00.000Z',
        updatedAt: '2026-07-25T00:00:00.000Z',
        segments: [],
      },
    })),
    prioritize: vi.fn(() => ({ accepted: true })),
  };
  const inlineTranslationService = {
    translate: vi.fn(),
  };
  registerTranslationIpcHandlers(
    () => ({
      isDestroyed: () => false,
      webContents: captured.webContents,
    }) as unknown as BrowserWindow,
    { translationService, inlineTranslationService } as unknown as TranslationServices,
  );
  return translationService;
}

function invoke(channel: string, request?: unknown): unknown {
  const handler = captured.handlers.get(channel);
  if (!handler) throw new Error(`Missing handler for ${channel}`);
  return handler({
    sender: captured.webContents,
    senderFrame: captured.webContents.mainFrame,
  }, request);
}

beforeEach(() => {
  captured.handlers.clear();
  captured.webContents.send.mockReset();
});

describe('Translation IPC handler', () => {
  it('forwards a new full-article Translation request to TranslationService', () => {
    const translationService = register();
    const request = {
      entryId: 7,
      sourceLanguage: 'auto' as const,
      targetLanguage: 'zh-CN' as const,
      useTerminology: true,
    };

    expect(invoke(TRANSLATION_IPC_CHANNELS.translationGenerate, request)).toEqual({
      ok: true,
      data: expect.objectContaining({ runId: 31, reused: false }),
    });
    expect(translationService.generate).toHaveBeenCalledOnce();
    expect(translationService.generate).toHaveBeenCalledWith(request);
  });
});
