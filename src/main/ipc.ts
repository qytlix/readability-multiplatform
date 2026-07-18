import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron';
import { IPC_CHANNELS, type PingResponse } from '../shared/ipc';
import { FEED_IPC_CHANNELS } from '../shared/contracts/feed.ipc';
import {
  createSyncCoordinator,
  registerFeedIpcHandlers,
} from './ipc/feed.handler';
import { SyncScheduler } from './feed/SyncScheduler';
import { registerExternalIpcHandlers } from './ipc/external.handler';
import {
  registerSummaryIpcHandlers,
} from './ipc/summary.handler';
import {
  getFeedServices,
  getSummaryServices,
} from './services';

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
  const feedServices = getFeedServices();
  if (feedServices) {
    const syncCoordinator = createSyncCoordinator(
      getMainWindow,
      feedServices.feedService,
      6,
    );
    const syncScheduler = new SyncScheduler(feedServices.feedStore, syncCoordinator, {
      intervalMin: 30,
    });
    feedServices.syncCoordinator = syncCoordinator;
    feedServices.syncScheduler = syncScheduler;
    registerFeedIpcHandlers(getMainWindow, feedServices);
  }

  registerExternalIpcHandlers(getMainWindow);

  const summaryServices = getSummaryServices();
  if (summaryServices) {
    registerSummaryIpcHandlers(getMainWindow, summaryServices);
  }
}
