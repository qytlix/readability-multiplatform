import {
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import { ANNOTATION_IPC_CHANNELS } from '../../shared/contracts/annotation.ipc';
import {
  ANNOTATION_COLORS,
  type AnnotationIdRequest,
  type AnnotationListRequest,
  type CreateAnnotationRequest,
  type UpdateAnnotationNoteRequest,
} from '../../shared/contracts/annotation.types';
import type { IPCResult } from '../../shared/contracts/feed.ipc';
import {
  ANNOTATION_ERROR_CODES,
  AnnotationError,
  toAnnotationIpcError,
} from '../../shared/errors/annotation.errors';
import type { AnnotationServices } from '../services';

type GetMainWindow = () => BrowserWindow | null;

export function registerAnnotationIpcHandlers(
  getMainWindow: GetMainWindow,
  services: AnnotationServices,
): void {
  ipcMain.handle(
    ANNOTATION_IPC_CHANNELS.list,
    (event: IpcMainInvokeEvent, request: unknown) => handle(
      event,
      getMainWindow,
      isListRequest(request),
      () => services.annotationService.list((request as AnnotationListRequest).entryId),
    ),
  );
  ipcMain.handle(
    ANNOTATION_IPC_CHANNELS.create,
    (event: IpcMainInvokeEvent, request: unknown) => handle(
      event,
      getMainWindow,
      isCreateRequest(request),
      () => services.annotationService.create(request as CreateAnnotationRequest),
    ),
  );
  ipcMain.handle(
    ANNOTATION_IPC_CHANNELS.updateNote,
    (event: IpcMainInvokeEvent, request: unknown) => handle(
      event,
      getMainWindow,
      isUpdateNoteRequest(request),
      () => services.annotationService.updateNote(
        request as UpdateAnnotationNoteRequest,
      ),
    ),
  );
  ipcMain.handle(
    ANNOTATION_IPC_CHANNELS.delete,
    (event: IpcMainInvokeEvent, request: unknown) => handle(
      event,
      getMainWindow,
      isAnnotationIdRequest(request),
      () => services.annotationService.delete(
        (request as AnnotationIdRequest).annotationId,
      ),
    ),
  );
}

function handle<T>(
  event: IpcMainInvokeEvent,
  getMainWindow: GetMainWindow,
  validRequest: boolean,
  action: () => T,
): IPCResult<T> {
  if (!isAuthorizedSender(event, getMainWindow)) {
    return {
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized IPC sender.',
        retryable: false,
      },
    };
  }
  if (!validRequest) {
    return {
      ok: false,
      error: toAnnotationIpcError(new AnnotationError(
        ANNOTATION_ERROR_CODES.INVALID_REQUEST,
        'The annotation request is invalid.',
      )),
    };
  }
  try {
    return { ok: true, data: action() };
  } catch (error) {
    return { ok: false, error: toAnnotationIpcError(error) };
  }
}

function isAuthorizedSender(
  event: IpcMainInvokeEvent,
  getMainWindow: GetMainWindow,
): boolean {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return (
    event.sender === mainWindow.webContents
    && event.senderFrame === mainWindow.webContents.mainFrame
  );
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isListRequest(value: unknown): value is AnnotationListRequest {
  return isRecord(value) && isPositiveInteger(value.entryId);
}

function isAnnotationIdRequest(value: unknown): value is AnnotationIdRequest {
  return isRecord(value) && isPositiveInteger(value.annotationId);
}

function isUpdateNoteRequest(
  value: unknown,
): value is UpdateAnnotationNoteRequest {
  return isRecord(value)
    && isPositiveInteger(value.annotationId)
    && typeof value.noteText === 'string';
}

function isCreateRequest(value: unknown): value is CreateAnnotationRequest {
  return isRecord(value)
    && isPositiveInteger(value.entryId)
    && Number.isInteger(value.startOffset)
    && Number.isInteger(value.endOffset)
    && typeof value.selectedText === 'string'
    && typeof value.prefixText === 'string'
    && typeof value.suffixText === 'string'
    && typeof value.color === 'string'
    && ANNOTATION_COLORS.some((color) => color === value.color);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}
