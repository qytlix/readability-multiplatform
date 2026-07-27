import {
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import { TAG_IPC_CHANNELS } from '../../shared/contracts/tag.ipc';
import type {
  EntryIdRequest,
  TagEntryRequest,
  UntagEntryRequest,
} from '../../shared/contracts/tag.types';
import type { CreateTagRequest } from '../../shared/contracts/tag.types';
import type { IPCResult } from '../../shared/contracts/feed.ipc';
import { toTagIpcError } from './shared/tag.errors';
import type { TagService } from './TagService';

type GetMainWindow = () => BrowserWindow | null;

export interface TagServices {
  tagService: TagService;
}

export function registerTagIpcHandlers(
  getMainWindow: GetMainWindow,
  services: TagServices,
): void {
  ipcMain.handle(
    TAG_IPC_CHANNELS.listByEntry,
    (event: IpcMainInvokeEvent, request: unknown) => handle(
      event,
      getMainWindow,
      isEntryIdRequest(request),
      () => services.tagService.listByEntry((request as EntryIdRequest).entryId),
    ),
  );
  ipcMain.handle(
    TAG_IPC_CHANNELS.createTag,
    (event: IpcMainInvokeEvent, request: unknown) => handle(
      event,
      getMainWindow,
      isCreateTagRequest(request),
      () => services.tagService.createTag((request as CreateTagRequest).tagName),
    ),
  );
  ipcMain.handle(
    TAG_IPC_CHANNELS.tagEntry,
    (event: IpcMainInvokeEvent, request: unknown) => handle(
      event,
      getMainWindow,
      isTagEntryRequest(request),
      () => services.tagService.tagEntry(
        (request as TagEntryRequest).entryId,
        (request as TagEntryRequest).tagName,
      ),
    ),
  );
  ipcMain.handle(
    TAG_IPC_CHANNELS.untagEntry,
    (event: IpcMainInvokeEvent, request: unknown) => handle(
      event,
      getMainWindow,
      isUntagEntryRequest(request),
      () => services.tagService.untagEntry(
        (request as UntagEntryRequest).entryId,
        (request as UntagEntryRequest).tagId,
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
      error: toTagIpcError({
        code: 'TAG_INVALID_REQUEST',
        message: 'The tag request is invalid.',
      }),
    };
  }
  try {
    return { ok: true, data: action() };
  } catch (error) {
    return { ok: false, error: toTagIpcError(error) };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function isEntryIdRequest(value: unknown): value is EntryIdRequest {
  return isRecord(value) && isPositiveInteger(value.entryId);
}

function isCreateTagRequest(value: unknown): value is CreateTagRequest {
  return isRecord(value) && typeof value.tagName === 'string';
}

function isTagEntryRequest(value: unknown): value is TagEntryRequest {
  return isRecord(value)
    && isPositiveInteger(value.entryId)
    && typeof value.tagName === 'string';
}

function isUntagEntryRequest(value: unknown): value is UntagEntryRequest {
  return isRecord(value)
    && isPositiveInteger(value.entryId)
    && isPositiveInteger(value.tagId);
}