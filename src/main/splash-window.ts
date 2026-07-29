import { BrowserWindow } from 'electron';
import path from 'node:path';

export function resolveSplashHtmlPath(options: {
  isPackaged: boolean;
  resourcesPath: string;
  moduleDirectory: string;
}): string {
  return options.isPackaged
    ? path.join(options.resourcesPath, 'splash', 'splash.html')
    : path.join(options.moduleDirectory, '../../resources/splash/splash.html');
}

export function createBrandSplashWindow(options: {
  htmlPath: string;
  linuxIconPath?: string;
}): BrowserWindow {
  const splashWindow = new BrowserWindow({
    width: 460,
    height: 320,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    center: true,
    backgroundColor: '#253034',
    icon: process.platform === 'linux' ? options.linuxIconPath : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  splashWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  splashWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  splashWindow.once('ready-to-show', () => {
    if (!splashWindow.isDestroyed()) splashWindow.show();
  });
  splashWindow.webContents.once('did-fail-load', () => {
    if (!splashWindow.isDestroyed()) splashWindow.close();
  });
  void splashWindow.loadFile(options.htmlPath).catch(() => {
    if (!splashWindow.isDestroyed()) splashWindow.close();
  });

  return splashWindow;
}
