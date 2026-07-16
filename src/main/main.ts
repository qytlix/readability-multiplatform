import { app, BrowserWindow } from 'electron';
import { env } from 'node:process';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { initializeServices, registerIpcHandlers, getSyncScheduler } from './ipc';
import { getAutomaticZoomFactor } from './window/automaticZoom';

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

const syncWindowZoom = (window: BrowserWindow): void => {
  const zoomFactor = getAutomaticZoomFactor(
    window.isMaximized() || window.isFullScreen(),
  );

  if (window.webContents.getZoomFactor() !== zoomFactor) {
    window.webContents.setZoomFactor(zoomFactor);
  }
};

const createWindow = (): void => {
  const newMainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1100,
    minHeight: 600,
    icon: process.platform === 'linux' ? linuxWindowIconPath : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow = newMainWindow;
  syncWindowZoom(newMainWindow);

  newMainWindow.on('resize', () => {
    syncWindowZoom(newMainWindow);
  });

  newMainWindow.on('maximize', () => {
    syncWindowZoom(newMainWindow);
  });

  newMainWindow.on('unmaximize', () => {
    syncWindowZoom(newMainWindow);
  });

  newMainWindow.on('enter-full-screen', () => {
    syncWindowZoom(newMainWindow);
  });

  newMainWindow.on('leave-full-screen', () => {
    syncWindowZoom(newMainWindow);
  });

  newMainWindow.webContents.on('did-finish-load', () => {
    syncWindowZoom(newMainWindow);
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
  // Initialize database with persistent path
  const dbPath = path.join(app.getPath('userData'), 'shale.db');
  initializeServices(dbPath);
  registerIpcHandlers(() => mainWindow);
  createWindow();

  // Start the sync scheduler (periodic feed sync)
  const scheduler = getSyncScheduler();
  if (scheduler) {
    scheduler.start();
  }
});

app.on('before-quit', () => {
  // Stop the sync scheduler
  const scheduler = getSyncScheduler();
  if (scheduler) {
    scheduler.stop();
  }
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
