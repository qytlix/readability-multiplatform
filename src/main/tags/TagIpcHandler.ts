import {
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import { TAG_IPC_CHANNELS } from '../../shared/contracts/tag.ipc';
import type {
  AutoTagConfirmRequest,
  AutoTagGenerateRequest,
  EntryIdRequest,
  TagEntryRequest,
  UntagEntryRequest,
} from '../../shared/contracts/tag.types';
import type { CreateTagRequest } from '../../shared/contracts/tag.types';
import type { IPCResult } from '../../shared/contracts/feed.ipc';
import { TAG_ERROR_CODES, TagError, toTagIpcError } from './shared/tag.errors';
import type { AutoTagService } from './AutoTagService';
import type { TagService } from './TagService';
import type { TagStore } from './TagStore';

type GetMainWindow = () => BrowserWindow | null;

export interface TagServices {
  tagService: TagService;
  tagStore: TagStore;
  autoTagService?: AutoTagService;
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

  // Simple getter — no request validation needed
  ipcMain.handle(
    TAG_IPC_CHANNELS.listAllWithCount,
    (event: IpcMainInvokeEvent) => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return {
          ok: false as const,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Unauthorized IPC sender.',
            retryable: false,
          },
        };
      }
      try {
        return { ok: true as const, data: services.tagService.listAllWithCount() };
      } catch (error) {
        return { ok: false as const, error: toTagIpcError(error) };
      }
    },
  );

  ipcMain.handle(
    TAG_IPC_CHANNELS.listAvailableForEntry,
    (event: IpcMainInvokeEvent, request: unknown) => handle(
      event,
      getMainWindow,
      isEntryIdRequest(request),
      () => services.tagService.listAvailableForEntry((request as EntryIdRequest).entryId),
    ),
  );

  // ── Auto-Tag handlers ──────────────────────────────────

  ipcMain.handle(
    TAG_IPC_CHANNELS.autoTagGenerate,
    async (event: IpcMainInvokeEvent, request: unknown) =>
      handleAsync(event, getMainWindow, isAutoTagGenerateRequest(request), async () => {
        if (!services.autoTagService) {
          throw new TagError(
            TAG_ERROR_CODES.PROVIDER_NOT_CONFIGURED,
            'Auto-tag service is not available.',
          );
        }
        const { entryId, maxCandidates } = request as AutoTagGenerateRequest;
        return services.autoTagService.generateCandidates(entryId, maxCandidates);
      }),
  );

  ipcMain.handle(
    TAG_IPC_CHANNELS.autoTagConfirm,
    async (event: IpcMainInvokeEvent, request: unknown) =>
      handleAsync(event, getMainWindow, isAutoTagConfirmRequest(request), async () => {
        if (!services.autoTagService) {
          throw new TagError(
            TAG_ERROR_CODES.PROVIDER_NOT_CONFIGURED,
            'Auto-tag service is not available.',
          );
        }
        const { entryId, tagNames } = request as AutoTagConfirmRequest;
        return services.autoTagService.confirmTags(entryId, tagNames);
      }),
  );

  ipcMain.handle(
    TAG_IPC_CHANNELS.autoTagCheckStatus,
    async (event: IpcMainInvokeEvent, request: unknown) =>
      handleAsync(event, getMainWindow, isEntryIdRequest(request), async () => {
        const { entryId } = request as EntryIdRequest;
        return { aiTagGenerated: services.tagStore.isAiTagGenerated(entryId) };
      }),
  );

  ipcMain.handle(
    TAG_IPC_CHANNELS.autoTagClearStatus,
    async (event: IpcMainInvokeEvent, request: unknown) =>
      handleAsync(event, getMainWindow, isEntryIdRequest(request), async () => {
        const { entryId } = request as EntryIdRequest;
        services.tagStore.setAiTagGenerated(entryId, false);
      }),
  );
}

async function handleAsync<T>(
  event: IpcMainInvokeEvent,
  getMainWindow: GetMainWindow,
  validRequest: boolean,
  action: () => Promise<T>,
): Promise<IPCResult<T>> {
  if (!isAuthorizedSender(event, getMainWindow)) {
    return {
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized IPC sender.', retryable: false },
    };
  }
  if (!validRequest) {
    return {
      ok: false,
      error: { code: 'TAG_INVALID_REQUEST', message: 'The auto-tag request is invalid.', retryable: false },
    };
  }
  try {
    return { ok: true, data: await action() };
  } catch (error) {
    return { ok: false, error: toTagIpcError(error) };
  }
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

function isAutoTagGenerateRequest(value: unknown): value is AutoTagGenerateRequest {
  return isRecord(value)
    && isPositiveInteger(value.entryId)
    && Number.isInteger(value.maxCandidates)
    && (value.maxCandidates as number) > 0
    && (value.maxCandidates as number) <= 50;
}

function isAutoTagConfirmRequest(value: unknown): value is AutoTagConfirmRequest {
  if (!isRecord(value) || !isPositiveInteger(value.entryId)) return false;
  const tagNames = value.tagNames;
  return Array.isArray(tagNames)
    && tagNames.length > 0
    && tagNames.length <= 50
    && tagNames.every((n): n is string => typeof n === 'string' && n.trim().length > 0);
}