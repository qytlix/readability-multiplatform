import { ipcMain, safeStorage, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
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
import { OpenAICompatibleProvider } from './ai/OpenAICompatibleProvider';
import { ProviderProfileStore } from './ai/ProviderProfileStore';
import { ProviderService } from './ai/ProviderService';
import { SecretStore } from './ai/SecretStore';
import { SummaryService } from './ai/SummaryService';
import { SummaryStore } from './ai/SummaryStore';
import { TranslationService } from './ai/TranslationService';
import { TranslationStore } from './ai/TranslationStore';
import {
  registerSummaryIpcHandlers,
  type SummaryServices,
} from './ipc/summary.handler';
import {
  registerTranslationIpcHandlers,
  type TranslationServices,
} from './ipc/translation.handler';

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
let summaryServices: SummaryServices | null = null;
let translationServices: TranslationServices | null = null;

/** Returns the Summary runtime for application shutdown cleanup. */
export function getSummaryService(): SummaryService | null {
  return summaryServices?.summaryService ?? null;
}

/** Returns the Translation runtime for application shutdown cleanup. */
export function getTranslationService(): TranslationService | null {
  return translationServices?.translationService ?? null;
}

/**
 * Initialize the database, run migrations, and create service instances.
 * Must be called before registerIpcHandlers.
 */
export function initializeServices(
  dbPath?: string,
  secretStoragePath?: string,
): FeedServices {
  const dbManager = new DatabaseManager(dbPath);
  dbManager.runMigrations();

  const feedStore = new FeedStore(dbManager.getDb());
  const entryStore = new EntryStore(dbManager.getDb());
  const contentStore = new ContentStore(dbManager.getDb());

  const feedService = new FeedService(feedStore, entryStore);
  const contentService = new ContentService(contentStore, entryStore);
  const providerProfileStore = new ProviderProfileStore(dbManager.getDb());
  const summaryStore = new SummaryStore(dbManager.getDb());
  summaryStore.reconcileInterruptedRuns();
  const translationStore = new TranslationStore(dbManager.getDb());
  translationStore.reconcileInterruptedRuns();
  const secretStore = new SecretStore(
    secretStoragePath ?? path.join(path.dirname(dbPath ?? '.'), 'ai-secrets.json'),
    safeStorage,
  );
  const provider = new OpenAICompatibleProvider();
  const providerService = new ProviderService(
    providerProfileStore,
    secretStore,
    provider,
  );
  const summaryService = new SummaryService(
    contentStore,
    providerProfileStore,
    secretStore,
    summaryStore,
    provider,
  );
  const translationService = new TranslationService(
    contentStore,
    providerProfileStore,
    secretStore,
    translationStore,
    provider,
  );

  feedServices = { feedService, contentService, entryStore, contentStore };
  summaryServices = { providerService, summaryService };
  translationServices = { translationService };
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

  if (summaryServices) {
    registerSummaryIpcHandlers(getMainWindow, summaryServices);
  }

  if (translationServices) {
    registerTranslationIpcHandlers(getMainWindow, translationServices);
  }
}
