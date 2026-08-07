import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => {
  const instances: Array<{
    options: Record<string, unknown>;
    windowEvents: Map<string, () => void>;
    webContentsEvents: Map<string, (event: { preventDefault: () => void }) => void>;
    show: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    loadFile: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
  }> = [];

  class BrowserWindow {
    options: Record<string, unknown>;
    windowEvents = new Map<string, () => void>();
    webContentsEvents = new Map<
      string,
      (event: { preventDefault: () => void }) => void
    >();
    show = vi.fn();
    close = vi.fn();
    loadFile = vi.fn().mockResolvedValue(undefined);
    isDestroyed = vi.fn().mockReturnValue(false);
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((
        event: string,
        listener: (event: { preventDefault: () => void }) => void,
      ) => this.webContentsEvents.set(event, listener)),
      once: vi.fn((
        event: string,
        listener: (event: { preventDefault: () => void }) => void,
      ) => this.webContentsEvents.set(event, listener)),
    };

    constructor(options: Record<string, unknown>) {
      this.options = options;
      instances.push(this);
    }

    once(event: string, listener: () => void): void {
      this.windowEvents.set(event, listener);
    }
  }

  return { BrowserWindow, instances };
});

vi.mock('electron', () => ({
  BrowserWindow: electronMock.BrowserWindow,
}));

import {
  createBrandSplashWindow,
  resolveSplashHtmlPath,
} from '../../../src/main/splash-window';

describe('brand splash window', () => {
  it('resolves development and packaged resource paths', () => {
    const developmentRoot = path.resolve('fixture-app');
    const moduleDirectory = path.join(developmentRoot, '.vite', 'build');
    const resourcesPath = path.resolve('fixture-resources');
    expect(resolveSplashHtmlPath({
      isPackaged: false,
      resourcesPath,
      moduleDirectory,
    })).toBe(path.join(developmentRoot, 'resources', 'splash', 'splash.html'));

    expect(resolveSplashHtmlPath({
      isPackaged: true,
      resourcesPath,
      moduleDirectory,
    })).toBe(path.join(resourcesPath, 'splash', 'splash.html'));
  });

  it('uses a frameless local-only window without a taskbar entry', async () => {
    electronMock.instances.length = 0;
    createBrandSplashWindow({
      htmlPath: 'E:\\app\\resources\\splash\\splash.html',
      linuxIconPath: 'E:\\app\\icon.png',
    });
    const instance = electronMock.instances[0];

    expect(instance.options).toMatchObject({
      width: 460,
      height: 320,
      show: false,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      backgroundColor: '#253034',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    expect(instance.loadFile).toHaveBeenCalledWith(
      'E:\\app\\resources\\splash\\splash.html',
    );
    instance.windowEvents.get('ready-to-show')?.();
    expect(instance.show).toHaveBeenCalledTimes(1);

    const navigationEvent = { preventDefault: vi.fn() };
    instance.webContentsEvents.get('will-navigate')?.(navigationEvent);
    expect(navigationEvent.preventDefault).toHaveBeenCalledTimes(1);
    await Promise.resolve();
  });

  it('closes immediately when the local page fails to load', () => {
    electronMock.instances.length = 0;
    createBrandSplashWindow({
      htmlPath: 'E:\\missing\\splash.html',
    });
    const instance = electronMock.instances[0];

    instance.webContentsEvents.get('did-fail-load')?.({
      preventDefault: vi.fn(),
    });
    expect(instance.close).toHaveBeenCalledTimes(1);
  });
});
