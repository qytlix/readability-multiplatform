import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { CHAT_IPC_CHANNELS } from '../../../src/shared/contracts/chat.ipc';
import type { ChatService } from '../../../src/main/ai/services/ChatService';
import type { ChatAttachmentService } from '../../../src/main/ai/services/ChatAttachmentService';

const captured = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, request: unknown) => unknown>(),
  showOpenDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, request: unknown) => unknown,
    ) => captured.handlers.set(channel, handler),
  },
  dialog: {
    showOpenDialog: captured.showOpenDialog,
  },
}));

import { registerChatIpcHandlers } from '../../../src/main/ipc/chat.handler';

function createAuthorizedWindow(): {
  mainWindow: BrowserWindow;
  event: IpcMainInvokeEvent;
  send: ReturnType<typeof vi.fn>;
} {
  const mainFrame = {};
  const send = vi.fn();
  const webContents = { mainFrame, send };
  return {
    mainWindow: {
      isDestroyed: () => false,
      webContents,
    } as unknown as BrowserWindow,
    event: {
      sender: webContents,
      senderFrame: mainFrame,
    } as unknown as IpcMainInvokeEvent,
    send,
  };
}

function invoke(channel: string, event: unknown, request: unknown): unknown {
  const handler = captured.handlers.get(channel);
  if (!handler) throw new Error(`Expected handler for ${channel}`);
  return handler(event, request);
}

function createService() {
  let eventListener: ((event: unknown) => void) | undefined;
  return {
    service: {
      getState: vi.fn(() => ({ state: 'idle' })),
      send: vi.fn(async () => ({
        runId: 11,
        threadId: 12,
        userMessageId: 13,
        assistantMessageId: 14,
        reused: false,
      })),
      cancel: vi.fn(),
      retry: vi.fn(),
      subscribe: vi.fn((listener: (event: unknown) => void) => {
        eventListener = listener;
        return () => {
          eventListener = undefined;
        };
      }),
    } as unknown as ChatService,
    emit: (event: unknown) => eventListener?.(event),
  };
}

function createAttachmentService(): ChatAttachmentService {
  return {
    importFiles: vi.fn(async () => ({
      canceled: false,
      attachments: [],
      failures: [],
    })),
    removeDraftAttachment: vi.fn(() => ({ removed: true })),
  } as unknown as ChatAttachmentService;
}

beforeEach(() => {
  captured.handlers.clear();
  captured.showOpenDialog.mockReset();
});

describe('Article Chat IPC handler', () => {
  it('validates and forwards a send request', async () => {
    const { mainWindow, event } = createAuthorizedWindow();
    const { service } = createService();
    registerChatIpcHandlers(
      () => mainWindow,
      service,
      createAttachmentService(),
    );
    const request = {
      entryId: 7,
      question: 'What is the conclusion?',
      attachmentIds: [],
    };

    await expect(invoke(CHAT_IPC_CHANNELS.send, event, request)).resolves.toEqual({
      ok: true,
      data: {
        runId: 11,
        threadId: 12,
        userMessageId: 13,
        assistantMessageId: 14,
        reused: false,
      },
    });
    expect(service.send).toHaveBeenCalledWith(request);
  });

  it('rejects malformed and unauthorized requests before the service boundary', async () => {
    const { mainWindow, event } = createAuthorizedWindow();
    const { service } = createService();
    registerChatIpcHandlers(
      () => mainWindow,
      service,
      createAttachmentService(),
    );

    expect(invoke(CHAT_IPC_CHANNELS.get, event, { entryId: 0 })).toEqual({
      ok: false,
      error: {
        code: 'CHAT_INVALID_REQUEST',
        message: 'The Article Chat request is invalid.',
        retryable: false,
      },
    });
    await expect(invoke(CHAT_IPC_CHANNELS.send, {}, {
      entryId: 7,
      question: 'Question',
      attachmentIds: [],
    })).resolves.toEqual({
      ok: false,
      error: {
        code: 'CHAT_UNAUTHORIZED',
        message: 'Unauthorized Article Chat IPC sender.',
        retryable: false,
      },
    });
    expect(service.getState).not.toHaveBeenCalled();
    expect(service.send).not.toHaveBeenCalled();
  });

  it('forwards identity-rich stream events only to the live main window', () => {
    const { mainWindow, send } = createAuthorizedWindow();
    const { service, emit } = createService();
    registerChatIpcHandlers(
      () => mainWindow,
      service,
      createAttachmentService(),
    );
    const streamEvent = {
      type: 'delta',
      runId: 1,
      threadId: 2,
      entryId: 3,
      messageId: 4,
      text: 'delta',
    };

    emit(streamEvent);

    expect(send).toHaveBeenCalledWith(CHAT_IPC_CHANNELS.stream, streamEvent);
  });

  it('keeps native attachment paths inside Main and returns safe metadata', async () => {
    const { mainWindow, event } = createAuthorizedWindow();
    const { service } = createService();
    const attachmentService = createAttachmentService();
    captured.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['C:\\private\\notes.md'],
    });
    vi.mocked(attachmentService.importFiles).mockResolvedValue({
      canceled: false,
      attachments: [{
        id: 21,
        threadId: 3,
        kind: 'text',
        displayName: 'notes.md',
        mimeType: 'text/plain',
        byteSize: 12,
        contentHash: 'hash',
        createdAt: '2026-07-30T00:00:00.000Z',
      }],
      failures: [],
    });
    registerChatIpcHandlers(
      () => mainWindow,
      service,
      attachmentService,
    );

    await expect(invoke(
      CHAT_IPC_CHANNELS.attachmentPick,
      event,
      { entryId: 7 },
    )).resolves.toEqual({
      ok: true,
      data: {
        canceled: false,
        attachments: [expect.objectContaining({ displayName: 'notes.md' })],
        failures: [],
      },
    });
    expect(attachmentService.importFiles).toHaveBeenCalledWith(
      7,
      ['C:\\private\\notes.md'],
    );
    expect(JSON.stringify(await invoke(
      CHAT_IPC_CHANNELS.attachmentPick,
      event,
      { entryId: 7 },
    ))).not.toContain('C:\\private');
  });
});
