import type { WebContents } from 'electron';

export const isAllowedMainWindowNavigation = (
  navigationUrl: string,
  applicationUrl: string,
): boolean => {
  try {
    const destination = new URL(navigationUrl);
    const application = new URL(applicationUrl);

    if (application.protocol === 'file:') {
      return destination.protocol === 'file:'
        && destination.pathname === application.pathname;
    }

    return destination.origin === application.origin;
  } catch {
    return false;
  }
};

/**
 * The main window is an application surface, never an in-app web browser.
 * New-window requests are denied here; Reader opens vetted links via IPC.
 */
export const installMainWindowNavigationGuards = (
  webContents: Pick<WebContents, 'on' | 'setWindowOpenHandler'>,
  applicationUrl: string,
): void => {
  const blockExternalNavigation = (
    event: Electron.Event,
    navigationUrl: string,
  ): void => {
    if (!isAllowedMainWindowNavigation(navigationUrl, applicationUrl)) {
      event.preventDefault();
    }
  };

  webContents.on('will-navigate', blockExternalNavigation);
  webContents.on('will-redirect', blockExternalNavigation);
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
};
