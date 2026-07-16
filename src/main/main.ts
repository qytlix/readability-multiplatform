import { app, BrowserWindow, Menu } from 'electron';
import { env } from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { initializeServices, registerIpcHandlers } from './ipc';
import { getApplicationMenuTemplate } from './application-menu';
import { installMainWindowNavigationGuards } from './navigation-guards';
import { initializePageZoom, installPageZoomInputGuard } from './page-zoom';

if (started) {
  app.quit();
}

// Wayland 兼容
if (env.XDG_SESSION_TYPE === 'wayland' || env.WAYLAND_DISPLAY) {
  env.ELECTRON_OZONE_PLATFORM_HINT = 'wayland';
  app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
  app.commandLine.appendSwitch('ozone-platform', 'wayland');
  app.commandLine.appendSwitch('in-process-gpu');
}

let mainWindow: BrowserWindow | null = null;

const linuxWindowIconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'shale-app-icon-512.png')
  : path.join(__dirname, '../../assets/icons/linux/shale-app-icon-512.png');

const createWindow = (): void => {
  const applicationUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ?? pathToFileURL(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    ).toString();
  const newMainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1100,
    minHeight: 600,
    show: false,
    icon: process.platform === 'linux' ? linuxWindowIconPath : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow = newMainWindow;
  installMainWindowNavigationGuards(newMainWindow.webContents, applicationUrl);
  installPageZoomInputGuard(newMainWindow.webContents);
  initializePageZoom(newMainWindow.webContents, () => {
    if (!newMainWindow.isDestroyed()) {
      newMainWindow.show();
    }
  });

  newMainWindow.on('closed', () => {
    if (mainWindow === newMainWindow) {
      mainWindow = null;
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    newMainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    newMainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

app.on('ready', () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(getApplicationMenuTemplate()));
  // Initialize database with persistent path
  const dbPath = path.join(app.getPath('userData'), 'shale.db');
  initializeServices(dbPath);
  registerIpcHandlers(() => mainWindow);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
