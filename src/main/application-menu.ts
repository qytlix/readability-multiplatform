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
