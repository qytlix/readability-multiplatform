import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import {
  CHAT_IPC_CHANNELS,
} from '../../shared/contracts/chat.ipc';
import type { IPCResult } from '../../shared/contracts/feed.ipc';
import type {
  ChatCancelRequest,
  ChatGetRequest,
  ChatRetryRequest,
  ChatRunResponse,
  ChatSelectionContext,
  ChatSendRequest,
  ChatState,
} from '../../shared/contracts/chat.types';
import {
  CHAT_ERROR_CODES,
  ChatError,
  toChatIpcError,
} from '../../shared/errors/chat.errors';
import type { ChatService } from '../ai/services/ChatService';

type GetMainWindow = () => BrowserWindow | null;

export function registerChatIpcHandlers(
  getMainWindow: GetMainWindow,
  chatService: ChatService,
): () => void {
  ipcMain.handle(
    CHAT_IPC_CHANNELS.get,
    (event, request: unknown): IPCResult<ChatState> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isChatGetRequest(request)) return invalidRequest();
      try {
        return { ok: true, data: chatService.getState(request) };
      } catch (error) {
        return { ok: false, error: toChatIpcError(error) };
      }
    },
  );

  ipcMain.handle(
    CHAT_IPC_CHANNELS.send,
    async (event, request: unknown): Promise<IPCResult<ChatRunResponse>> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isChatSendRequest(request)) return invalidRequest();
      try {
        return { ok: true, data: await chatService.send(request) };
      } catch (error) {
        return { ok: false, error: toChatIpcError(error) };
      }
    },
  );

  ipcMain.handle(
    CHAT_IPC_CHANNELS.cancel,
    (event, request: unknown): IPCResult<void> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isRunRequest(request)) return invalidRequest();
      try {
        chatService.cancel(request);
        return { ok: true, data: undefined };
      } catch (error) {
        return { ok: false, error: toChatIpcError(error) };
      }
    },
  );

  ipcMain.handle(
    CHAT_IPC_CHANNELS.retry,
    async (event, request: unknown): Promise<IPCResult<ChatRunResponse>> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isRunRequest(request)) return invalidRequest();
      try {
        return { ok: true, data: await chatService.retry(request) };
      } catch (error) {
        return { ok: false, error: toChatIpcError(error) };
      }
    },
  );

  return chatService.subscribe((streamEvent) => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(CHAT_IPC_CHANNELS.stream, streamEvent);
    }
  });
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

export function isChatGetRequest(value: unknown): value is ChatGetRequest {
  return isRecord(value) && isPositiveInteger(value.entryId);
}

export function isChatSendRequest(value: unknown): value is ChatSendRequest {
  if (
    !isRecord(value)
    || !isPositiveInteger(value.entryId)
    || typeof value.question !== 'string'
    || !value.question.trim()
    || value.question.length > 20_000
    || !Array.isArray(value.attachmentIds)
    || value.attachmentIds.length > 5
    || !value.attachmentIds.every(isPositiveInteger)
    || new Set(value.attachmentIds).size !== value.attachmentIds.length
  ) {
    return false;
  }

  return value.selection === undefined
    || isSelection(value.selection, value.entryId);
}

function isSelection(
  value: unknown,
  entryId: number,
): value is ChatSelectionContext {
  return (
    isRecord(value)
    && value.entryId === entryId
    && typeof value.text === 'string'
    && Boolean(value.text.trim())
    && typeof value.paragraphContext === 'string'
    && Boolean(value.paragraphContext.trim())
    && (
      value.segmentId === undefined
      || (
        typeof value.segmentId === 'string'
        && Boolean(value.segmentId.trim())
        && value.segmentId.length <= 512
      )
    )
  );
}

function isRunRequest(
  value: unknown,
): value is ChatCancelRequest & ChatRetryRequest {
  return isRecord(value) && isPositiveInteger(value.runId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function invalidRequest(): IPCResult<never> {
  return {
    ok: false,
    error: toChatIpcError(new ChatError(
      CHAT_ERROR_CODES.CHAT_INVALID_REQUEST,
      'The Article Chat request is invalid.',
      false,
    )),
  };
}

function unauthorized(): IPCResult<never> {
  return {
    ok: false,
    error: toChatIpcError(new ChatError(
      CHAT_ERROR_CODES.CHAT_UNAUTHORIZED,
      'Unauthorized Article Chat IPC sender.',
      false,
    )),
  };
}
