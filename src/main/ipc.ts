import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS, type PingResponse } from '../shared/ipc';

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

export const registerIpcHandlers = (getMainWindow: GetMainWindow): void => {
  ipcMain.handle(IPC_CHANNELS.systemPing, (event): PingResponse => {
    if (!isAuthorizedSender(event, getMainWindow)) {
      throw new Error('Unauthorized IPC sender.');
    }

    return {
      ok: true,
      message: 'pong',
    };
  });
};
