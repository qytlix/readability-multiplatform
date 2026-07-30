import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { IPCResult } from '../../shared/contracts/feed.ipc';
import { CHAT_IPC_CHANNELS } from '../../shared/contracts/chat.ipc';
import type {
  ChatCancelRequest,
  ChatClearRequest,
  ChatGetRequest,
  ChatSendRequest,
  ChatSendResponse,
  ChatState,
} from '../../shared/contracts/chat.types';
import { toChatIpcError } from '../../shared/errors/chat.errors';
import type { ChatService } from '../ai/services/ChatService';

type GetMainWindow = () => BrowserWindow | null;

export function registerChatIpcHandlers(
  getMainWindow: GetMainWindow,
  chatService: ChatService,
): void {
  chatService.subscribe((event) => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(CHAT_IPC_CHANNELS.stream, event);
    }
  });

  ipcMain.handle(
    CHAT_IPC_CHANNELS.get,
    (event: IpcMainInvokeEvent, request: unknown): IPCResult<ChatState> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isEntryRequest(request)) return invalidRequest();
      try {
        return success(chatService.getState(request));
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    CHAT_IPC_CHANNELS.send,
    (event: IpcMainInvokeEvent, request: unknown): IPCResult<ChatSendResponse> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isSendRequest(request)) return invalidRequest();
      try {
        return success(chatService.send(request));
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    CHAT_IPC_CHANNELS.cancel,
    (event: IpcMainInvokeEvent, request: unknown): IPCResult<void> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isCancelRequest(request)) return invalidRequest();
      try {
        chatService.cancel(request);
        return success(undefined);
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    CHAT_IPC_CHANNELS.clear,
    (event: IpcMainInvokeEvent, request: unknown): IPCResult<void> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isEntryRequest(request)) return invalidRequest();
      try {
        chatService.clear(request);
        return success(undefined);
      } catch (error) {
        return failure(error);
      }
    },
  );
}

function isAuthorizedSender(
  event: IpcMainInvokeEvent,
  getMainWindow: GetMainWindow,
): boolean {
  const mainWindow = getMainWindow();
  return Boolean(
    mainWindow
    && !mainWindow.isDestroyed()
    && event.sender === mainWindow.webContents
    && event.senderFrame === mainWindow.webContents.mainFrame,
  );
}

function isEntryRequest(value: unknown): value is ChatGetRequest & ChatClearRequest {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as Record<string, unknown>).entryId === 'number',
  );
}

function isSendRequest(value: unknown): value is ChatSendRequest {
  return isEntryRequest(value)
    && typeof (value as unknown as Record<string, unknown>).question === 'string';
}

function isCancelRequest(value: unknown): value is ChatCancelRequest {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as Record<string, unknown>).runId === 'number',
  );
}

function success<T>(data: T): IPCResult<T> {
  return { ok: true, data };
}

function failure(error: unknown): IPCResult<never> {
  return { ok: false, error: toChatIpcError(error) };
}

function invalidRequest(): IPCResult<never> {
  return {
    ok: false,
    error: {
      code: 'CHAT_INVALID_REQUEST',
      message: '文章问答请求无效。',
      retryable: false,
    },
  };
}

function unauthorized(): IPCResult<never> {
  return {
    ok: false,
    error: {
      code: 'CHAT_UNAUTHORIZED',
      message: 'Unauthorized IPC sender.',
      retryable: false,
    },
  };
}
