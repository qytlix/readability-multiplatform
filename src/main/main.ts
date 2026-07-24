import { app, BrowserWindow, Menu } from 'electron';
import { performance } from 'node:perf_hooks';
import { release } from 'node:os';
import { env } from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import {
  getSummaryService,
  getInlineTranslationService,
  getTranslationService,
  getSyncScheduler,
  initializeServices,
} from './services';
import { registerIpcHandlers } from './ipc';
import { registerDiagnosticsIpcHandlers } from './ipc/diagnostics.handler';
import { DiagnosticExportService } from './diagnostics/DiagnosticExportService';
import type {
  DiagnosticDisplayEnvironment,
  DiagnosticRuntimeInfo,
} from '../shared/contracts/diagnostics.types';
import type {
  ContentOperationLogger,
  FeedOperationLogger,
  OPMLOperationLogger,
} from './feed/services';
import type { ProviderOperationLogger } from './ai/services/ProviderLogging';
import type { SummaryOperationLogger } from './ai/services/SummaryLogging';
import { removeApplicationMenu } from './application-menu';
import { MAIN_LIFECYCLE_EVENTS } from './logging/MainLifecycleEvents';
import { StructuredLogger, type AppInitializationPhase } from './logging/StructuredLogger';
import { NormalShutdownCoordinator } from './logging/NormalShutdownCoordinator';
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
let lifecycleLogger: StructuredLogger | null = null;

const normalShutdownCoordinator = new NormalShutdownCoordinator({
  getLogger: () => lifecycleLogger,
  stopApplicationWork: () => {
    getSyncScheduler()?.stop();
    getSummaryService()?.abortActiveRun();
    getInlineTranslationService()?.close();
    getTranslationService()?.close();
  },
  requestQuit: () => app.quit(),
});

const linuxWindowIconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'shale-app-icon-512.png')
  : path.join(__dirname, '../../assets/icons/linux/shale-app-icon-512.png');

const terminologyDbPath = app.isPackaged
  ? path.join(process.resourcesPath, 'terminology-libraries.sqlite')
  : path.join(__dirname, '../../resources/terminology/terminology-libraries.sqlite');

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

async function flushLifecycleLogger(): Promise<void> {
  try {
    await lifecycleLogger?.flush();
  } catch {
    // Logging must not replace the application's existing startup failure.
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

async function initializeApplication(): Promise<void> {
  const applicationInitializationStartedAt = performance.now();
  const structuredLogDirectory = path.join(app.getPath('logs'), 'structured');
  try {
    lifecycleLogger = new StructuredLogger({
      directory: structuredLogDirectory,
    });
  } catch {
    lifecycleLogger = null;
  }

  lifecycleLogger?.info(MAIN_LIFECYCLE_EVENTS.starting, 'app.lifecycle', {
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  });

  removeApplicationMenu(Menu);
  // Initialize database with persistent path
  const dbPath = path.join(app.getPath('userData'), 'shale.db');
  const secretStoragePath = path.join(app.getPath('userData'), 'ai-secrets.json');
  // Preserve startup behavior if logger construction itself was unavailable;
  // no second on-disk logger is created.
  const operationLogger: FeedOperationLogger
    & ContentOperationLogger
    & OPMLOperationLogger
    & ProviderOperationLogger
    & SummaryOperationLogger = lifecycleLogger ?? {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  const databaseInitializationStartedAt = performance.now();
  lifecycleLogger?.info(MAIN_LIFECYCLE_EVENTS.databaseInitializeStarted, 'database.lifecycle');
  try {
    initializeServices(
      dbPath,
      secretStoragePath,
      operationLogger,
      terminologyDbPath,
    );
  } catch (error) {
    lifecycleLogger?.error(MAIN_LIFECYCLE_EVENTS.databaseInitializeFailed, 'database.lifecycle', {
      durationMs: elapsedMilliseconds(databaseInitializationStartedAt),
      success: false,
      errorCode: 'DATABASE_INITIALIZATION_FAILED',
    });
    await flushLifecycleLogger();
    throw error;
  }

  lifecycleLogger?.info(MAIN_LIFECYCLE_EVENTS.databaseInitializeCompleted, 'database.lifecycle', {
    durationMs: elapsedMilliseconds(databaseInitializationStartedAt),
    success: true,
  });

  let phase: AppInitializationPhase = 'services';
  try {
    phase = 'ipc';
    registerIpcHandlers(() => mainWindow, operationLogger);
    registerDiagnosticsIpcHandlers(
      () => mainWindow,
      new DiagnosticExportService({
        logDirectory: structuredLogDirectory,
        runtime: createDiagnosticRuntimeInfo(),
      }),
    );
    phase = 'window';
    createWindow();
    phase = 'sync';
    getSyncScheduler()?.start();
  } catch (error) {
    lifecycleLogger?.error(MAIN_LIFECYCLE_EVENTS.initializationFailed, 'app.lifecycle', {
      errorCode: 'APP_INITIALIZATION_FAILED',
      phase,
    });
    await flushLifecycleLogger();
    throw error;
  }

  lifecycleLogger?.info(MAIN_LIFECYCLE_EVENTS.ready, 'app.lifecycle', {
    durationMs: elapsedMilliseconds(applicationInitializationStartedAt),
  });
}

function createDiagnosticRuntimeInfo(): DiagnosticRuntimeInfo {
  return {
    applicationVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? null,
    nodeVersion: process.versions.node ?? null,
    operatingSystem: process.platform,
    operatingSystemRelease: release(),
    architecture: process.arch,
    isPackaged: app.isPackaged,
    display: getDiagnosticDisplayEnvironment(),
  };
}

function getDiagnosticDisplayEnvironment(): DiagnosticDisplayEnvironment {
  if (process.platform !== 'linux') {
    return {
      session: 'not-applicable',
      waylandDetected: false,
      ozonePlatform: 'not-applicable',
    };
  }

  const session = env.XDG_SESSION_TYPE === 'wayland'
    ? 'wayland'
    : env.XDG_SESSION_TYPE === 'x11'
      ? 'x11'
      : 'unknown';
  const ozonePlatform = env.ELECTRON_OZONE_PLATFORM_HINT === 'wayland'
    ? 'wayland'
    : env.ELECTRON_OZONE_PLATFORM_HINT === 'x11'
      ? 'x11'
      : env.ELECTRON_OZONE_PLATFORM_HINT
        ? 'unknown'
        : 'default';

  return {
    session,
    waylandDetected: Boolean(env.WAYLAND_DISPLAY),
    ozonePlatform,
  };
}

void app.whenReady().then(initializeApplication);

app.on('before-quit', (event) => {
  normalShutdownCoordinator.handleBeforeQuit(event);
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
