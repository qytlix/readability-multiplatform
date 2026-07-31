import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { SUMMARY_IPC_CHANNELS } from '../../../src/shared/contracts/summary.ipc';

const captured = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, request?: unknown) => unknown>(),
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

import { registerSummaryIpcHandlers } from '../../../src/main/ipc/summary.handler';
import type { SummaryServices } from '../../../src/main/services';

function createAuthorizedWindow(): {
  mainWindow: BrowserWindow;
  event: IpcMainInvokeEvent;
} {
  const mainFrame = {};
  const webContents = { mainFrame, send: vi.fn() };
  return {
    mainWindow: {
      isDestroyed: () => false,
      webContents,
    } as unknown as BrowserWindow,
    event: {
      sender: webContents,
      senderFrame: mainFrame,
    } as unknown as IpcMainInvokeEvent,
  };
}

beforeEach(() => {
  captured.handlers.clear();
});

describe('provider model catalog IPC handler', () => {
  it('returns safe model metadata from the authorized Main service', async () => {
    const { mainWindow, event } = createAuthorizedWindow();
    const listChatModels = vi.fn().mockResolvedValue({
      providerKind: 'openai',
      models: [{ id: 'gpt-5.4', ownedBy: 'openai' }],
    });
    registerSummaryIpcHandlers(
      () => mainWindow,
      {
        providerService: { listChatModels },
        summaryService: { subscribe: vi.fn() },
      } as unknown as SummaryServices,
    );

    const handler = captured.handlers.get(
      SUMMARY_IPC_CHANNELS.providerListChatModels,
    );
    await expect(handler?.(event)).resolves.toEqual({
      ok: true,
      data: {
        providerKind: 'openai',
        models: [{ id: 'gpt-5.4', ownedBy: 'openai' }],
      },
    });
    expect(listChatModels).toHaveBeenCalledOnce();
  });

  it('does not query models for an unauthorized renderer', async () => {
    const listChatModels = vi.fn();
    registerSummaryIpcHandlers(
      () => null,
      {
        providerService: { listChatModels },
        summaryService: { subscribe: vi.fn() },
      } as unknown as SummaryServices,
    );

    const handler = captured.handlers.get(
      SUMMARY_IPC_CHANNELS.providerListChatModels,
    );
    await expect(handler?.({})).resolves.toEqual({
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized IPC sender.',
        retryable: false,
      },
    });
    expect(listChatModels).not.toHaveBeenCalled();
  });
});
