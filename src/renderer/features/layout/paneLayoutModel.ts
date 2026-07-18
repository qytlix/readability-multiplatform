export const PANE_LAYOUT = {
  version: 2,
  dividerWidth: 6,
  collapsedRailWidth: 34,
  collapseThreshold: 44,
  readerMinWidth: 480,
  feed: {
    defaultWidth: 224,
    minWidth: 216,
    maxWidth: 340,
  },
  entry: {
    defaultWidth: 400,
    minWidth: 360,
    maxWidth: 560,
  },
  keyboardStep: 10,
  keyboardLargeStep: 40,
} as const;

export type ResizablePane = 'feed' | 'entry';
export type DragEndReason =
  | 'pointerup'
  | 'pointercancel'
  | 'lostpointercapture'
  | 'windowblur'
  | 'unmount';

export interface PanePreference {
  /** The user's last expanded width. A collapsed rail never overwrites this. */
  width: number;
  collapsed: boolean;
}

export interface PaneLayoutPreference {
  version: number;
  feed: PanePreference;
  entry: PanePreference;
}

export interface PaneTrack {
  collapsed: boolean;
  /** The effective expanded width after the current container constraints. */
  expandedWidth: number;
  trackWidth: number;
  dividerWidth: number;
}

export interface PaneTrackLayout {
  feed: PaneTrack;
  entry: PaneTrack;
  readerMinWidth: number;
}

export const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const getPaneConfig = (pane: ResizablePane) =>
  pane === 'feed' ? PANE_LAYOUT.feed : PANE_LAYOUT.entry;

export const getOtherPane = (pane: ResizablePane): ResizablePane =>
  pane === 'feed' ? 'entry' : 'feed';

const normalizePanePreference = (
  pane: ResizablePane,
  preference: PanePreference,
): PanePreference => {
  const config = getPaneConfig(pane);

  return {
    width: clamp(
      isFiniteNumber(preference.width) ? preference.width : config.defaultWidth,
      config.minWidth,
      config.maxWidth,
    ),
    collapsed: preference.collapsed === true,
  };
};

export const getDefaultPaneLayoutPreference = (): PaneLayoutPreference => ({
  version: PANE_LAYOUT.version,
  feed: {
    width: PANE_LAYOUT.feed.defaultWidth,
    collapsed: false,
  },
  entry: {
    width: PANE_LAYOUT.entry.defaultWidth,
    collapsed: false,
  },
});

export const normalizePaneLayoutPreference = (
  preference: PaneLayoutPreference,
): PaneLayoutPreference => ({
  version: PANE_LAYOUT.version,
  feed: normalizePanePreference('feed', preference.feed),
  entry: normalizePanePreference('entry', preference.entry),
});
