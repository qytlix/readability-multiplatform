import { app, BrowserWindow, Menu, screen } from 'electron';
import { env } from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import {
  getSummaryService,
  getSyncScheduler,
  initializeServices,
  registerIpcHandlers,
} from './ipc';
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
let hasLoggedWindowsDpiDiagnostics = false;

const windowsDpiDiagnosticSwitches = [
  'force-device-scale-factor',
  'high-dpi-support',
  'enable-use-zoom-for-dsf',
  'enable-features',
  'disable-features',
] as const;

const logWindowsDpiDiagnostics = (window: BrowserWindow): void => {
  if (
    process.platform !== 'win32'
    || app.isPackaged
    || hasLoggedWindowsDpiDiagnostics
  ) {
    return;
  }

  hasLoggedWindowsDpiDiagnostics = true;
  const windowBounds = window.getBounds();
  const display = screen.getDisplayMatching(windowBounds);
  const knownDpiSwitches = Object.fromEntries(
    windowsDpiDiagnosticSwitches.map((switchName) => {
      const present = app.commandLine.hasSwitch(switchName);

      return [
        switchName,
        {
          present,
          value: present ? app.commandLine.getSwitchValue(switchName) : null,
        },
      ];
    }),
  );

  console.info('[Shale] Windows DPI diagnostics', {
    display: {
      id: display.id,
      label: display.label,
      scaleFactor: display.scaleFactor,
      bounds: display.bounds,
      size: display.size,
      workArea: display.workArea,
      workAreaSize: display.workAreaSize,
    },
    window: {
      bounds: windowBounds,
      contentBounds: window.getContentBounds(),
      contentSize: window.getContentSize(),
    },
    webContents: {
      url: window.webContents.getURL(),
      zoomFactor: window.webContents.getZoomFactor(),
    },
    process: {
      argv: process.argv,
      executablePath: process.execPath,
      appExecutablePath: app.getPath('exe'),
      resourcesPath: process.resourcesPath,
      isPackaged: app.isPackaged,
      electronVersion: process.versions.electron,
    },
    dpiRelatedArguments: process.argv.filter((argument) => (
      /dpi|scale|zoom|device|display/i.test(argument)
    )),
    commandLineSwitches: knownDpiSwitches,
    forgeWindowsManifestConfiguration: {
      source: 'forge.config.ts',
      maker: 'MakerSquirrel({})',
      win32MetadataConfigured: false,
      applicationManifestConfigured: false,
      dpiAwarenessConfigured: false,
      packagedExecutableManifestInspected: false,
    },
  });
};

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
      logWindowsDpiDiagnostics(newMainWindow);
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
  const secretStoragePath = path.join(app.getPath('userData'), 'ai-secrets.json');
  initializeServices(dbPath, secretStoragePath);
  registerIpcHandlers(() => mainWindow);
  createWindow();

  getSyncScheduler()?.start();
});

app.on('before-quit', () => {
  getSyncScheduler()?.stop();
  getSummaryService()?.abortActiveRun();
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
