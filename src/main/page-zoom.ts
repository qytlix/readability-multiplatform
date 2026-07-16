import type { Input, WebContents } from 'electron';

export const PAGE_ZOOM_FACTOR = 1;

type PageZoomWebContents = Pick<WebContents, 'on' | 'once' | 'setZoomFactor'>;
type PageZoomInput = Pick<Input, 'type' | 'key' | 'code' | 'control' | 'meta' | 'alt'>;

const zoomShortcutKeys = new Set(['+', '=', '-', '_', '0']);
const zoomShortcutCodes = new Set([
  'Equal',
  'Minus',
  'NumpadAdd',
  'NumpadSubtract',
  'Digit0',
  'Numpad0',
]);

export const resetPageZoom = (
  webContents: Pick<WebContents, 'setZoomFactor'>,
): void => {
  webContents.setZoomFactor(PAGE_ZOOM_FACTOR);
};

/**
 * A Chromium zoom preference is associated with the loaded origin. Set the
 * baseline only after the application page has finished navigating so a
 * persisted origin preference cannot overwrite it again.
 */
export const initializePageZoom = (
  webContents: PageZoomWebContents,
  onInitialized?: () => void,
): void => {
  webContents.once('did-finish-load', () => {
    resetPageZoom(webContents);
    onInitialized?.();
  });
};

const isPageZoomShortcut = (input: PageZoomInput): boolean => {
  if (input.type !== 'keyDown' || (!input.control && !input.meta) || input.alt) {
    return false;
  }

  return zoomShortcutKeys.has(input.key) || zoomShortcutCodes.has(input.code);
};

/**
 * Shale intentionally has no whole-page zoom control. Keyboard requests are
 * stopped before Chromium handles them; wheel zoom requests are cancelled at
 * Electron's zoom boundary. Plain scrolling never enters either path.
 */
export const installPageZoomInputGuard = (
  webContents: PageZoomWebContents,
): void => {
  webContents.on('before-input-event', (event, input) => {
    if (isPageZoomShortcut(input)) {
      event.preventDefault();
      resetPageZoom(webContents);
    }
  });

  webContents.on('zoom-changed', (event) => {
    event.preventDefault();
    resetPageZoom(webContents);
  });
};
