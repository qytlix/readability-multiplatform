import {
  Menu,
  type BrowserWindow,
} from 'electron';

interface ApplicationMenuController {
  setApplicationMenu: (menu: null) => void;
}

/**
 * Shale uses its own in-window controls and does not expose Electron's native
 * File/Edit/View/Window menu bar.
 */
export const removeApplicationMenu = (
  menuController: ApplicationMenuController,
): void => {
  menuController.setApplicationMenu(null);
};

/**
 * Register F12 / Ctrl+Shift+I to toggle DevTools.
 * Call after window creation, only in dev mode.
 */
export const registerDevToolsShortcut = (
  window: BrowserWindow,
): void => {
  const toggleDevTools = (): void => {
    if (window.isDestroyed()) return;
    if (window.webContents.isDevToolsOpened()) {
      window.webContents.closeDevTools();
    } else {
      window.webContents.openDevTools({ mode: 'bottom' });
    }
  };

  window.webContents.on('before-input-event', (_event, input) => {
    if (
      input.key === 'F12'
      || (input.control && input.shift && input.key.toLowerCase() === 'i')
      || (input.meta && input.alt && input.key.toLowerCase() === 'i')
    ) {
      toggleDevTools();
    }
  });
};
