import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { FeedService, SyncCoordinator } from '../feed/services';
import { FEED_IPC_CHANNELS } from '../../shared/contracts/feed.ipc';
import type { ShaleError } from '../../shared/errors/feed.errors';
import type {
  FeedAddRequest,
  FeedSyncRequest,
  FeedRemoveRequest,
  FeedUpdateRequest,
  ContentFetchRequest,
  ContentGetRequest,
  EntryListRequest,
  EntryMarkReadRequest,
  EntryMarkStarredRequest,
  IPCResult,
  FeedSyncProgress,
  OPMLImportRequest,
  OPMLExportRequest,
} from '../../shared/contracts/feed.ipc';
import type { Feed, EntryListItem } from '../../shared/contracts/feed.types';
import type { CleanedContent } from '../../shared/contracts/content.types';
import type { FeedServices } from '../services';

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

/** Send a sync progress event to the renderer. */
function sendSyncProgress(
  getMainWindow: GetMainWindow,
  progress: FeedSyncProgress,
): void {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(FEED_IPC_CHANNELS.feedSyncProgress, progress);
  }
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
  const {
    feedService,
    contentService,
    entryStore,
    contentStore,
    syncCoordinator,
    opmlImportService,
    opmlExportService,
  } = services;

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
    ): Promise<IPCResult<{
      feed: Feed;
      newCount: number;
      entries: EntryListItem[];
    }>> => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return failure({ code: 'UNAUTHORIZED', message: 'Unauthorized IPC sender.' });
      }

      try {
        if (request.feedId !== undefined) {
          // Single feed sync via coordinator (which handles dedup)
          const result = await syncCoordinator.syncFeed(request.feedId);
          return success(result);
        }

        // Full sync via coordinator
        const results = await syncCoordinator.syncAll();
        const feeds = await feedService.getFeeds();
        const allEntries = entryStore.query({ limit: 50 });
        return success({
          feed: feeds[0] ?? {
            id: 0,
            feedURL: '',
            lastSyncStatus: 'never',
            syncIntervalMin: 30,
            createdAt: new Date().toISOString(),
          },
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

  ipcMain.handle(
    FEED_IPC_CHANNELS.feedUpdate,
    async (
      event: IpcMainInvokeEvent,
      request: FeedUpdateRequest,
    ): Promise<IPCResult<Feed>> => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return failure({ code: 'UNAUTHORIZED', message: 'Unauthorized IPC sender.' });
      }

      try {
        const feed = await feedService.updateFeed(request.feedId, request.params);
        return success(feed);
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    FEED_IPC_CHANNELS.feedSyncCancel,
    async (event: IpcMainInvokeEvent): Promise<IPCResult<void>> => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return failure({ code: 'UNAUTHORIZED', message: 'Unauthorized IPC sender.' });
      }

      try {
        syncCoordinator.cancelAll();
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

  // ── OPML ───────────────────────────────────────────────

  ipcMain.handle(
    FEED_IPC_CHANNELS.opmlImport,
    async (
      event: IpcMainInvokeEvent,
      request: OPMLImportRequest,
    ): Promise<IPCResult<{ successCount: number; skipCount: number; failures: Array<{ title?: string; xmlUrl?: string; error: string }>; totalFound: number }>> => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return failure({ code: 'UNAUTHORIZED', message: 'Unauthorized IPC sender.' });
      }

      try {
        // Read file content in main process
        const fs = await import('node:fs/promises');
        const xml = await fs.readFile(request.filePath, 'utf-8');
        const result = await opmlImportService.importFromContent(xml, request.mode);
        return success(result);
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    FEED_IPC_CHANNELS.opmlExport,
    async (
      event: IpcMainInvokeEvent,
      request: OPMLExportRequest,
    ): Promise<IPCResult<void>> => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return failure({ code: 'UNAUTHORIZED', message: 'Unauthorized IPC sender.' });
      }

      try {
        await opmlExportService.exportToFile(request.filePath);
        return success(undefined);
      } catch (error) {
        return failure(error);
      }
    },
  );
}

/**
 * Create a SyncCoordinator that emits progress events to the renderer.
 */
export function createSyncCoordinator(
  getMainWindow: GetMainWindow,
  feedService: FeedService,
  maxConcurrency?: number,
): SyncCoordinator {
  return new SyncCoordinator(feedService, {
    maxConcurrency,
    onFeedProgress: (feedId, status, feedTitle, newCount, error) => {
      sendSyncProgress(getMainWindow, {
        feedId,
        feedTitle,
        status: status as FeedSyncProgress['status'],
        newCount,
        error,
        timestamp: new Date().toISOString(),
      });
    },
  });
}
