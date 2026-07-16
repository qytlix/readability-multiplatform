import type { MenuItemConstructorOptions } from 'electron';

const separator: MenuItemConstructorOptions = { type: 'separator' };

/**
 * Electron's implicit View menu includes page zoom roles. Define the small
 * application menu explicitly so the remaining platform-standard commands do
 * not expose whole-page scaling.
 */
export const getApplicationMenuTemplate = (
  platform: string = process.platform,
): MenuItemConstructorOptions[] => {
  const isMac = platform === 'darwin';

  return [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { role: 'close' as const },
        ...(isMac ? [] : [{ role: 'quit' as const }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        separator,
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        separator,
        { role: 'togglefullscreen' as const },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'close' as const },
      ],
    },
  ];
};
