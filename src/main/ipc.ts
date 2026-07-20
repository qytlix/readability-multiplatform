import {
  dialog,
  ipcMain,
  safeStorage,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { IPC_CHANNELS, type PingResponse } from '../shared/ipc';
import { FEED_IPC_CHANNELS } from '../shared/contracts/feed.ipc';
import {
  createSyncCoordinator,
  registerFeedIpcHandlers,
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
import { registerExternalIpcHandlers } from './ipc/external.handler';
import { OpenAICompatibleProvider } from './ai/OpenAICompatibleProvider';
import { ProviderProfileStore } from './ai/ProviderProfileStore';
import { ProviderService } from './ai/ProviderService';
import { SecretStore } from './ai/SecretStore';
import { SummaryService } from './ai/SummaryService';
import { SummaryStore } from './ai/SummaryStore';
import { TranslationService } from './ai/TranslationService';
import { InlineTranslationService } from './ai/InlineTranslationService';
import { TranslationStore } from './ai/TranslationStore';
import {
  EmptyTerminologyLookup,
  TerminologyStore,
} from './ai/TerminologyStore';
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
let syncScheduler: SyncScheduler | null = null;

/** Returns the feed sync scheduler for application lifecycle cleanup. */
export function getSyncScheduler(): SyncScheduler | null {
  return syncScheduler;
}

/** Returns the Summary runtime for application shutdown cleanup. */
export function getSummaryService(): SummaryService | null {
  return summaryServices?.summaryService ?? null;
}

/** Returns the Translation runtime for application shutdown cleanup. */
export function getTranslationService(): TranslationService | null {
  return translationServices?.translationService ?? null;
}

/** Returns the one-shot inline Translation runtime for shutdown cleanup. */
export function getInlineTranslationService(): InlineTranslationService | null {
  return translationServices?.inlineTranslationService ?? null;
}

/**
 * Initialize the database, run migrations, and create service instances.
 * Must be called before registerIpcHandlers.
 */
export function initializeServices(
  dbPath?: string,
  secretStoragePath?: string,
  terminologyDbPath?: string,
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
  const terminologyLookup = terminologyDbPath && existsSync(terminologyDbPath)
    ? new TerminologyStore(terminologyDbPath)
    : new EmptyTerminologyLookup();
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
    undefined,
    terminologyLookup,
  );
  const inlineTranslationService = new InlineTranslationService(
    providerProfileStore,
    secretStore,
    provider,
  );

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
  summaryServices = { providerService, summaryService };
  translationServices = { translationService, inlineTranslationService };
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

  ipcMain.handle(
    FEED_IPC_CHANNELS.dialogOpenFile,
    async (
      event,
      options: {
        title?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
        defaultPath?: string;
      },
    ) => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return { canceled: true, filePaths: [] };
      }

      const mainWindow = getMainWindow();
      const dialogOptions: OpenDialogOptions = {
        title: options.title ?? 'Select a file',
        filters: options.filters ?? [{ name: 'All Files', extensions: ['*'] }],
        defaultPath: options.defaultPath,
        properties: ['openFile'],
      };
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);

      return { canceled: result.canceled, filePaths: result.filePaths };
    },
  );

  ipcMain.handle(
    FEED_IPC_CHANNELS.dialogSaveFile,
    async (
      event,
      options: {
        title?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
        defaultPath?: string;
      },
    ) => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return { canceled: true, filePath: '' };
      }

      const mainWindow = getMainWindow();
      const dialogOptions = {
        title: options.title ?? 'Save file',
        filters: options.filters ?? [{ name: 'All Files', extensions: ['*'] }],
        defaultPath: options.defaultPath,
      };
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions);

      return { canceled: result.canceled, filePath: result.filePath ?? '' };
    },
  );

  // Feed module handlers (only if services are initialized)
  if (feedServices) {
    const syncCoordinator = createSyncCoordinator(
      getMainWindow,
      feedServices.feedService,
      6,
    );
    syncScheduler = new SyncScheduler(feedServices.feedStore, syncCoordinator, {
      intervalMin: 30,
    });
    feedServices.syncCoordinator = syncCoordinator;
    feedServices.syncScheduler = syncScheduler;
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
