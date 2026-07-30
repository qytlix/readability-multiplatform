import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  CHAT_IPC_CHANNELS,
} from '../../shared/contracts/chat.ipc';
import type { IPCResult } from '../../shared/contracts/feed.ipc';
import {
  CHAT_SELECTION_LIMITS,
  type ChatAttachmentPickResponse,
  type ChatAttachmentPreviewRequest,
  type ChatAttachmentPreviewResponse,
  type ChatAttachmentRemoveRequest,
  type ChatAttachmentRemoveResponse,
  type ChatClipboardImageImportRequest,
  type ChatClipboardImageImportResponse,
  type ChatCancelRequest,
  type ChatGetRequest,
  type ChatRetryRequest,
  type ChatRunResponse,
  type ChatSelectionContext,
  type ChatSendRequest,
  type ChatState,
} from '../../shared/contracts/chat.types';
import {
  CHAT_ERROR_CODES,
  ChatError,
  toChatIpcError,
} from '../../shared/errors/chat.errors';
import type { ChatService } from '../ai/services/ChatService';
import type { ChatAttachmentService } from '../ai/services/ChatAttachmentService';

type GetMainWindow = () => BrowserWindow | null;

export function registerChatIpcHandlers(
  getMainWindow: GetMainWindow,
  chatService: ChatService,
  attachmentService: ChatAttachmentService,
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

  ipcMain.handle(
    CHAT_IPC_CHANNELS.attachmentPick,
    async (
      event,
      request: unknown,
    ): Promise<IPCResult<ChatAttachmentPickResponse>> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isChatGetRequest(request)) return invalidRequest();
      const mainWindow = getMainWindow();
      if (!mainWindow) return unauthorized();
      try {
        const picked = await dialog.showOpenDialog(mainWindow, {
          title: '选择问答附件',
          properties: ['openFile', 'multiSelections'],
          filters: [
            {
              name: '文章问答附件',
              extensions: [
                'txt',
                'md',
                'markdown',
                'csv',
                'json',
                'html',
                'htm',
                'pdf',
                'png',
                'jpg',
                'jpeg',
                'webp',
              ],
            },
          ],
        });
        if (picked.canceled || picked.filePaths.length === 0) {
          return {
            ok: true,
            data: { canceled: true, attachments: [], failures: [] },
          };
        }
        return {
          ok: true,
          data: await attachmentService.importFiles(
            request.entryId,
            picked.filePaths,
          ),
        };
      } catch (error) {
        return { ok: false, error: toChatIpcError(error) };
      }
    },
  );

  ipcMain.handle(
    CHAT_IPC_CHANNELS.attachmentRemove,
    (
      event,
      request: unknown,
    ): IPCResult<ChatAttachmentRemoveResponse> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isAttachmentRemoveRequest(request)) return invalidRequest();
      try {
        return {
          ok: true,
          data: attachmentService.removeDraftAttachment(
            request.entryId,
            request.attachmentId,
          ),
        };
      } catch (error) {
        return { ok: false, error: toChatIpcError(error) };
      }
    },
  );

  ipcMain.handle(
    CHAT_IPC_CHANNELS.attachmentImportClipboardImage,
    (
      event,
      request: unknown,
    ): IPCResult<ChatClipboardImageImportResponse> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isClipboardImageImportRequest(request)) return invalidRequest();
      try {
        return {
          ok: true,
          data: {
            attachment: attachmentService.importClipboardImage(
              request.entryId,
              request.bytes,
              request.suggestedDisplayName,
              request.declaredMimeType,
            ),
          },
        };
      } catch (error) {
        return { ok: false, error: toChatIpcError(error) };
      }
    },
  );

  ipcMain.handle(
    CHAT_IPC_CHANNELS.attachmentPreview,
    (
      event,
      request: unknown,
    ): IPCResult<ChatAttachmentPreviewResponse> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isAttachmentPreviewRequest(request)) return invalidRequest();
      try {
        return {
          ok: true,
          data: attachmentService.previewImage(
            request.entryId,
            request.attachmentId,
          ),
        };
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
    && value.text.length <= CHAT_SELECTION_LIMITS.textCharacters
    && typeof value.paragraphContext === 'string'
    && Boolean(value.paragraphContext.trim())
    && value.paragraphContext.length
      <= CHAT_SELECTION_LIMITS.paragraphCharacters
    && (
      value.segmentId === undefined
      || (
        typeof value.segmentId === 'string'
        && Boolean(value.segmentId.trim())
        && value.segmentId.length <= CHAT_SELECTION_LIMITS.segmentIdCharacters
      )
    )
  );
}

function isRunRequest(
  value: unknown,
): value is ChatCancelRequest & ChatRetryRequest {
  return isRecord(value) && isPositiveInteger(value.runId);
}

function isAttachmentRemoveRequest(
  value: unknown,
): value is ChatAttachmentRemoveRequest {
  return isRecord(value)
    && isPositiveInteger(value.entryId)
    && isPositiveInteger(value.attachmentId);
}

function isClipboardImageImportRequest(
  value: unknown,
): value is ChatClipboardImageImportRequest {
  return isRecord(value)
    && isPositiveInteger(value.entryId)
    && value.bytes instanceof Uint8Array
    && value.bytes.length > 0
    && value.bytes.length <= 10 * 1024 * 1024
    && typeof value.suggestedDisplayName === 'string'
    && value.suggestedDisplayName.length <= 180
    && typeof value.declaredMimeType === 'string'
    && value.declaredMimeType.length <= 100;
}

function isAttachmentPreviewRequest(
  value: unknown,
): value is ChatAttachmentPreviewRequest {
  return isRecord(value)
    && isPositiveInteger(value.entryId)
    && isPositiveInteger(value.attachmentId);
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
