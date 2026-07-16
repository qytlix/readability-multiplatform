import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS, type PingResponse } from '../shared/ipc';
import {
  registerFeedIpcHandlers,
  type FeedServices,
} from './ipc/feed.handler';
import { DatabaseManager } from './database/DatabaseManager';
import { FeedStore } from './feed/FeedStore';
import { EntryStore } from './feed/EntryStore';
import { ContentStore } from './feed/ContentStore';
import { FeedService } from './feed/FeedService';
import { ContentService } from './feed/ContentService';
import { registerExternalIpcHandlers } from './ipc/external.handler';

export type GetMainWindow = () => BrowserWindow | null;

export const isAuthorizedSender = (
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

  feedServices = { feedService, contentService, entryStore, contentStore };
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

  // Feed module handlers (only if services are initialized)
  if (feedServices) {
    registerFeedIpcHandlers(getMainWindow, feedServices);
  }

  registerExternalIpcHandlers(getMainWindow);
}
