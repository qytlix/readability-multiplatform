import {
  getDefaultPaneLayoutPreference,
  normalizePaneLayoutPreference,
  type PaneLayoutPreference,
} from './paneLayoutModel';
import {
  isVersionOneStoredLayout,
  parseStoredPaneLayoutPreference,
} from './paneLayoutSerialization';

export const PANE_LAYOUT_STORAGE_KEY = 'shale.workspace-layout';

export const loadPaneLayoutPreference = (): PaneLayoutPreference => {
  try {
    const rawValue = window.localStorage.getItem(PANE_LAYOUT_STORAGE_KEY);
    const preference = parseStoredPaneLayoutPreference(rawValue);

    if (isVersionOneStoredLayout(rawValue)) {
      try {
        window.localStorage.setItem(PANE_LAYOUT_STORAGE_KEY, JSON.stringify(preference));
      } catch {
        // A valid v1 preference remains usable when the one-time migration write fails.
      }
    }

    return preference;
  } catch {
    return getDefaultPaneLayoutPreference();
  }
};

export const savePaneLayoutPreference = (
  preference: PaneLayoutPreference,
): void => {
  try {
    window.localStorage.setItem(
      PANE_LAYOUT_STORAGE_KEY,
      JSON.stringify(normalizePaneLayoutPreference(preference)),
    );
  } catch {
    // Storage can be disabled or full; layout persistence must not block reading.
  }
};
