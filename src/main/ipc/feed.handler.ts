import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { FeedStore } from '../feed/FeedStore';
import { EntryStore } from '../feed/EntryStore';
import { ContentStore } from '../feed/ContentStore';
import { FeedService } from '../feed/FeedService';
import { ContentService } from '../feed/ContentService';
import { FEED_IPC_CHANNELS } from '../../shared/contracts/feed.ipc';
import type { ShaleError } from '../../shared/errors/feed.errors';
import type {
  FeedAddRequest,
  FeedSyncRequest,
  FeedRemoveRequest,
  ContentFetchRequest,
  ContentGetRequest,
  EntryListRequest,
  EntryMarkReadRequest,
  EntryMarkStarredRequest,
  IPCResult,
} from '../../shared/contracts/feed.ipc';
import type { Feed, EntryListItem } from '../../shared/contracts/feed.types';
import type { CleanedContent } from '../../shared/contracts/content.types';
import type { SyncResult } from '../feed/FeedService';
import type { SyncResult as SyncAllResult } from '../feed/FeedService';

type GetMainWindow = () => BrowserWindow | null;

const isAuthorizedSender = (
  event: IpcMainInvokeEvent,
  getMainWindow: GetMainWindow,
): boolean => {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return (
    event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame
  );
};

export interface FeedServices {
  feedService: FeedService;
  contentService: ContentService;
  entryStore: EntryStore;
  contentStore: ContentStore;
}

function success<T>(data: T): IPCResult<T> {
  return { ok: true, data };
}

function failure(error: unknown): { ok: false; error: ShaleError } {
  const err = error as any;
  return {
    ok: false as const,
    error: {
      code: err?.code ?? 'UNKNOWN_ERROR',
      message: err?.message ?? String(error),
      retryable: err?.retryable ?? false,
    },
  };
}

export function registerFeedIpcHandlers(
  getMainWindow: GetMainWindow,
  services: FeedServices,
): void {
  const { feedService, contentService, entryStore, contentStore } = services;

  // ── Feed ──────────────────────────────────────────────

  ipcMain.handle(
    FEED_IPC_CHANNELS.feedAdd,
    async (
      event: IpcMainInvokeEvent,
      request: FeedAddRequest,
    ): Promise<IPCResult<{ feed: Feed; entries: EntryListItem[] }>> => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return failure({ code: 'UNAUTHORIZED', message: 'Unauthorized IPC sender.' });
      }

      try {
        return success(await feedService.addFeed(request.url));
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    FEED_IPC_CHANNELS.feedList,
    async (event: IpcMainInvokeEvent): Promise<IPCResult<Feed[]>> => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return failure({ code: 'UNAUTHORIZED', message: 'Unauthorized IPC sender.' });
      }

      try {
        return success(await feedService.getFeeds());
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    FEED_IPC_CHANNELS.feedSync,
    async (
      event: IpcMainInvokeEvent,
      request: FeedSyncRequest,
    ): Promise<IPCResult<SyncResult>> => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return failure({ code: 'UNAUTHORIZED', message: 'Unauthorized IPC sender.' });
      }

      try {
        if (request.feedId !== undefined) {
          return success(await feedService.syncFeed(request.feedId));
        }
        // Full sync: syncAll returns per-feed results; aggregate into a SyncResult
        const results = await feedService.syncAll();
        const feeds = await feedService.getFeeds();
        const allEntries = entryStore.query({ limit: 50 });
        return success({
          feed: feeds[0],
          newCount: results.filter((r) => r.success).length,
          entries: allEntries.entries,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    FEED_IPC_CHANNELS.feedRemove,
    async (
      event: IpcMainInvokeEvent,
      request: FeedRemoveRequest,
    ): Promise<IPCResult<void>> => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return failure({ code: 'UNAUTHORIZED', message: 'Unauthorized IPC sender.' });
      }

      try {
        await feedService.removeFeed(request.feedId);
        return success(undefined);
      } catch (error) {
        return failure(error);
      }
    },
  );

  // ── Entry ─────────────────────────────────────────────

  ipcMain.handle(
    FEED_IPC_CHANNELS.entryList,
    async (
      event: IpcMainInvokeEvent,
      request: EntryListRequest,
    ): Promise<IPCResult<{ entries: EntryListItem[]; nextCursor?: { publishedAt: string; id: number } }>> => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return failure({ code: 'UNAUTHORIZED', message: 'Unauthorized IPC sender.' });
      }

      try {
        return success(entryStore.query(request));
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    FEED_IPC_CHANNELS.entryMarkRead,
    async (
      event: IpcMainInvokeEvent,
      request: EntryMarkReadRequest,
    ): Promise<IPCResult<void>> => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return failure({ code: 'UNAUTHORIZED', message: 'Unauthorized IPC sender.' });
      }

      try {
        entryStore.markRead(request.ids, request.isRead);
        return success(undefined);
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    FEED_IPC_CHANNELS.entryMarkStarred,
    async (
      event: IpcMainInvokeEvent,
      request: EntryMarkStarredRequest,
    ): Promise<IPCResult<void>> => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return failure({ code: 'UNAUTHORIZED', message: 'Unauthorized IPC sender.' });
      }

      try {
        entryStore.markStarred(request.id, request.isStarred);
        return success(undefined);
      } catch (error) {
        return failure(error);
      }
    },
  );

  // ── Content ───────────────────────────────────────────

  ipcMain.handle(
    FEED_IPC_CHANNELS.contentFetch,
    async (
      event: IpcMainInvokeEvent,
      request: ContentFetchRequest,
    ): Promise<IPCResult<CleanedContent>> => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return failure({ code: 'UNAUTHORIZED', message: 'Unauthorized IPC sender.' });
      }

      try {
        return success(await contentService.fetchAndClean(request.entryId));
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    FEED_IPC_CHANNELS.contentGet,
    async (
      event: IpcMainInvokeEvent,
      request: ContentGetRequest,
    ): Promise<IPCResult<CleanedContent | null>> => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return failure({ code: 'UNAUTHORIZED', message: 'Unauthorized IPC sender.' });
      }

      try {
        const result = await contentService.getContent(request.entryId);
        return success(result ?? null);
      } catch (error) {
        return failure(error);
      }
    },
  );
}
