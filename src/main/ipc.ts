import { ipcMain, dialog, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS, type PingResponse } from '../shared/ipc';
import { FEED_IPC_CHANNELS } from '../shared/contracts/feed.ipc';
import {
  registerFeedIpcHandlers,
  createSyncCoordinator,
  type FeedServices,
} from './ipc/feed.handler';
import { DatabaseManager } from './database/DatabaseManager';
import { FeedStore } from './feed/FeedStore';
import { EntryStore } from './feed/EntryStore';
import { ContentStore } from './feed/ContentStore';
import { FeedService } from './feed/FeedService';
import { ContentService } from './feed/ContentService';
import { SyncCoordinator } from './feed/SyncCoordinator';
import { SyncScheduler } from './feed/SyncScheduler';
import { OPMLImportService } from './feed/OPMLImportService';
import { OPMLExportService } from './feed/OPMLExportService';

type GetMainWindow = () => BrowserWindow | null;

const isAuthorizedSender = (
  event: IpcMainInvokeEvent,
  getMainWindow: GetMainWindow,
): boolean => {
  const mainWindow = getMainWindow();

  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  const { webContents } = mainWindow;

  return (
    event.sender === webContents && event.senderFrame === webContents.mainFrame
  );
};

let feedServices: FeedServices | null = null;
let syncScheduler: SyncScheduler | null = null;

/**
 * Get the SyncScheduler instance (for lifecycle management).
 */
export function getSyncScheduler(): SyncScheduler | null {
  return syncScheduler;
}

/**
 * Initialize the database, run migrations, and create service instances.
 * Must be called before registerIpcHandlers.
 */
export function initializeServices(dbPath?: string): FeedServices {
  const dbManager = new DatabaseManager(dbPath);
  dbManager.runMigrations();

  const feedStore = new FeedStore(dbManager.getDb());
  const entryStore = new EntryStore(dbManager.getDb());
  const contentStore = new ContentStore(dbManager.getDb());

  const feedService = new FeedService(feedStore, entryStore);
  const contentService = new ContentService(contentStore, entryStore);

  feedServices = {
    feedService,
    contentService,
    entryStore,
    contentStore,
    feedStore,
    syncCoordinator: null as unknown as SyncCoordinator,
    syncScheduler: null as unknown as SyncScheduler,
    opmlImportService: new OPMLImportService(feedStore),
    opmlExportService: new OPMLExportService(feedStore),
  };

  return feedServices;
}

export function registerIpcHandlers(getMainWindow: GetMainWindow): void {
  // System ping handler
  ipcMain.handle(IPC_CHANNELS.systemPing, (event): PingResponse => {
    if (!isAuthorizedSender(event, getMainWindow)) {
      throw new Error('Unauthorized IPC sender.');
    }

    return {
      ok: true,
      message: 'pong',
    };
  });

  // ── System handlers ────────────────────────────────

  ipcMain.handle(
    FEED_IPC_CHANNELS.systemOpenExternal,
    async (event, { url }: { url: string }) => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return { ok: false, error: 'Unauthorized' };
      }

      try {
        await shell.openExternal(url);
        return { ok: true };
      } catch {
        return { ok: false, error: 'Failed to open URL' };
      }
    },
  );

  // ── File Dialog handlers ───────────────────────────

  ipcMain.handle(
    FEED_IPC_CHANNELS.dialogOpenFile,
    async (event, options: { title?: string; filters?: Array<{ name: string; extensions: string[] }>; defaultPath?: string }) => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return { canceled: true, filePaths: [] };
      }

      const win = getMainWindow();
      const result = win
        ? await dialog.showOpenDialog(win, {
            title: options.title ?? 'Select a file',
            filters: options.filters ?? [{ name: 'All Files', extensions: ['*'] }],
            defaultPath: options.defaultPath,
            properties: ['openFile'],
          })
        : await dialog.showOpenDialog({
            title: options.title ?? 'Select a file',
            filters: options.filters ?? [{ name: 'All Files', extensions: ['*'] }],
            defaultPath: options.defaultPath,
            properties: ['openFile'],
          });

      return { canceled: result.canceled, filePaths: result.filePaths };
    },
  );

  ipcMain.handle(
    FEED_IPC_CHANNELS.dialogSaveFile,
    async (event, options: { title?: string; filters?: Array<{ name: string; extensions: string[] }>; defaultPath?: string }) => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return { canceled: true, filePath: '' };
      }

      const win = getMainWindow();
      const result = win
        ? await dialog.showSaveDialog(win, {
            title: options.title ?? 'Save file',
            filters: options.filters ?? [{ name: 'All Files', extensions: ['*'] }],
            defaultPath: options.defaultPath,
          })
        : await dialog.showSaveDialog({
            title: options.title ?? 'Save file',
            filters: options.filters ?? [{ name: 'All Files', extensions: ['*'] }],
            defaultPath: options.defaultPath,
          });

      return { canceled: result.canceled, filePath: result.filePath ?? '' };
    },
  );

  // Feed module handlers (only if services are initialized)
  if (feedServices) {
    // Create SyncCoordinator that emits progress to renderer
    const coordinator = createSyncCoordinator(
      getMainWindow,
      feedServices.feedService,
      6,
    );

    // Create SyncScheduler
    syncScheduler = new SyncScheduler(feedServices.feedStore, coordinator, {
      intervalMin: 30,
    });

    // Store coordinator and scheduler on feedServices
    feedServices.syncCoordinator = coordinator;
    feedServices.syncScheduler = syncScheduler;

    registerFeedIpcHandlers(getMainWindow, feedServices);
  }
}