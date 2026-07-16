export const PANE_LAYOUT = {
  storageKey: 'shale.workspace-layout',
  version: 2,
  dividerWidth: 6,
  collapsedRailWidth: 34,
  collapseThreshold: 44,
  readerMinWidth: 480,
  /**
   * At this width the default track widths match their saved pixel values.
   * Wider desktops scale the defaults up so the navigation panes do not look
   * undersized beside a full-screen Reader.
   */
  desktopReferenceWidth: 1280,
  maximumDesktopScale: 1.75,
  feed: {
    defaultWidth: 224,
    minWidth: 216,
    maxWidth: 340,
    wideMaxWidth: 420,
  },
  entry: {
    defaultWidth: 400,
    minWidth: 360,
    maxWidth: 560,
    wideMaxWidth: 680,
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

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const getPaneConfig = (pane: ResizablePane) =>
  pane === 'feed' ? PANE_LAYOUT.feed : PANE_LAYOUT.entry;

const getOtherPane = (pane: ResizablePane): ResizablePane =>
  pane === 'feed' ? 'entry' : 'feed';

const getStoredMaximumWidth = (pane: ResizablePane): number =>
  getPaneConfig(pane).wideMaxWidth;

const normalizePanePreference = (
  pane: ResizablePane,
  preference: PanePreference,
): PanePreference => {
  const config = getPaneConfig(pane);

  return {
    width: clamp(
      isFiniteNumber(preference.width) ? preference.width : config.defaultWidth,
      config.minWidth,
      getStoredMaximumWidth(pane),
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

export const getMinimumWorkspaceWidth = (): number =>
  PANE_LAYOUT.feed.minWidth
  + PANE_LAYOUT.entry.minWidth
  + PANE_LAYOUT.readerMinWidth
  + PANE_LAYOUT.dividerWidth * 2;

const getSafeContainerWidth = (containerWidth: number): number =>
  isFiniteNumber(containerWidth) && containerWidth > 0
    ? containerWidth
    : getMinimumWorkspaceWidth();

const getDesktopScale = (containerWidth: number): number => clamp(
  getSafeContainerWidth(containerWidth) / PANE_LAYOUT.desktopReferenceWidth,
  1,
  PANE_LAYOUT.maximumDesktopScale,
);

const getResponsiveMaximumPaneWidth = (
  pane: ResizablePane,
  containerWidth: number,
): number => {
  const config = getPaneConfig(pane);

  return clamp(
    config.maxWidth * getDesktopScale(containerWidth),
    config.maxWidth,
    config.wideMaxWidth,
  );
};

const getResponsiveDefaultPaneWidth = (
  pane: ResizablePane,
  containerWidth: number,
): number => {
  const config = getPaneConfig(pane);

  return clamp(
    config.defaultWidth * getDesktopScale(containerWidth),
    config.minWidth,
    getResponsiveMaximumPaneWidth(pane, containerWidth),
  );
};

const getResponsiveMinimumPaneWidth = (
  pane: ResizablePane,
  containerWidth: number,
): number => {
  const config = getPaneConfig(pane);

  return getDesktopScale(containerWidth) > 1
    ? getResponsiveDefaultPaneWidth(pane, containerWidth)
    : config.minWidth;
};

/**
 * A saved user width remains authoritative when it is larger than the
 * responsive default. This keeps manual enlargement stable while allowing
 * untouched, small-window defaults to grow on a wide desktop.
 */
const getExpandedPaneWidth = (
  pane: ResizablePane,
  preference: PaneLayoutPreference,
  containerWidth: number,
): number => {
  const config = getPaneConfig(pane);

  return clamp(
    Math.max(
      preference[pane].width,
      getResponsiveDefaultPaneWidth(pane, containerWidth),
    ),
    config.minWidth,
    getResponsiveMaximumPaneWidth(pane, containerWidth),
  );
};

const getMinimumNonReaderWidth = (preference: PaneLayoutPreference): number => {
  const feedMinimumWidth = preference.feed.collapsed
    ? PANE_LAYOUT.collapsedRailWidth
    : PANE_LAYOUT.feed.minWidth;
  const entryMinimumWidth = preference.entry.collapsed
    ? PANE_LAYOUT.collapsedRailWidth
    : PANE_LAYOUT.entry.minWidth;
  const dividerCount = Number(!preference.feed.collapsed)
    + Number(!preference.entry.collapsed);

  return feedMinimumWidth
    + entryMinimumWidth
    + dividerCount * PANE_LAYOUT.dividerWidth;
};

const getEffectiveReaderMinimumWidth = (
  preference: PaneLayoutPreference,
  containerWidth: number,
): number => Math.min(
  PANE_LAYOUT.readerMinWidth,
  Math.max(0, getSafeContainerWidth(containerWidth) - getMinimumNonReaderWidth(preference)),
);

const getAvailableExpandedPaneWidth = (
  preference: PaneLayoutPreference,
  containerWidth: number,
): number => {
  const collapsedRailCount = Number(preference.feed.collapsed)
    + Number(preference.entry.collapsed);
  const dividerCount = Number(!preference.feed.collapsed)
    + Number(!preference.entry.collapsed);

  return getSafeContainerWidth(containerWidth)
    - getEffectiveReaderMinimumWidth(preference, containerWidth)
    - collapsedRailCount * PANE_LAYOUT.collapsedRailWidth
    - dividerCount * PANE_LAYOUT.dividerWidth;
};

/**
 * Calculates all five Grid tracks from the persisted preference. Collapsed
 * panes consume only their rail and have no ordinary resize divider.
 */
export const getPaneTrackLayout = (
  inputPreference: PaneLayoutPreference,
  containerWidth: number,
): PaneTrackLayout => {
  const preference = normalizePaneLayoutPreference(inputPreference);
  let feedExpandedWidth = getExpandedPaneWidth('feed', preference, containerWidth);
  let entryExpandedWidth = getExpandedPaneWidth('entry', preference, containerWidth);
  const readerMinWidth = getEffectiveReaderMinimumWidth(preference, containerWidth);
  const availableExpandedPaneWidth = getAvailableExpandedPaneWidth(
    preference,
    containerWidth,
  );
  const expandedPaneWidth = (preference.feed.collapsed ? 0 : feedExpandedWidth)
    + (preference.entry.collapsed ? 0 : entryExpandedWidth);
  let excessWidth = expandedPaneWidth - availableExpandedPaneWidth;

  if (excessWidth > 0 && !preference.entry.collapsed) {
    const entryReduction = Math.min(
      excessWidth,
      entryExpandedWidth - PANE_LAYOUT.entry.minWidth,
    );
    entryExpandedWidth -= entryReduction;
    excessWidth -= entryReduction;
  }

  if (excessWidth > 0 && !preference.feed.collapsed) {
    feedExpandedWidth = Math.max(
      PANE_LAYOUT.feed.minWidth,
      feedExpandedWidth - excessWidth,
    );
  }

  return {
    feed: {
      collapsed: preference.feed.collapsed,
      expandedWidth: feedExpandedWidth,
      trackWidth: preference.feed.collapsed
        ? PANE_LAYOUT.collapsedRailWidth
        : feedExpandedWidth,
      dividerWidth: preference.feed.collapsed ? 0 : PANE_LAYOUT.dividerWidth,
    },
    entry: {
      collapsed: preference.entry.collapsed,
      expandedWidth: entryExpandedWidth,
      trackWidth: preference.entry.collapsed
        ? PANE_LAYOUT.collapsedRailWidth
        : entryExpandedWidth,
      dividerWidth: preference.entry.collapsed ? 0 : PANE_LAYOUT.dividerWidth,
    },
    readerMinWidth,
  };
};

export const getPaneBounds = (
  pane: ResizablePane,
  preference: PaneLayoutPreference,
  containerWidth: number,
): { minWidth: number; maxWidth: number } => {
  const normalizedPreference = normalizePaneLayoutPreference(preference);
  const tracks = getPaneTrackLayout(normalizedPreference, containerWidth);
  const otherPane = getOtherPane(pane);
  const otherTrack = tracks[otherPane];
  const minimumWidth = getResponsiveMinimumPaneWidth(pane, containerWidth);
  const maximumWidth = getResponsiveMaximumPaneWidth(pane, containerWidth);
  const occupiedWidth = tracks.readerMinWidth
    + PANE_LAYOUT.dividerWidth
    + (otherTrack.collapsed
      ? PANE_LAYOUT.collapsedRailWidth
      : otherTrack.expandedWidth + PANE_LAYOUT.dividerWidth);
  const dynamicMaximum = getSafeContainerWidth(containerWidth) - occupiedWidth;

  return {
    minWidth: minimumWidth,
    maxWidth: Math.max(minimumWidth, Math.min(maximumWidth, dynamicMaximum)),
  };
};

export const resizePanePreference = (
  pane: ResizablePane,
  requestedWidth: number,
  inputPreference: PaneLayoutPreference,
  containerWidth: number,
): PaneLayoutPreference => {
  const preference = normalizePaneLayoutPreference(inputPreference);
  const { minWidth, maxWidth } = getPaneBounds(pane, preference, containerWidth);
  const currentWidth = preference[pane].width;
  const nextWidth = clamp(
    isFiniteNumber(requestedWidth) ? requestedWidth : currentWidth,
    minWidth,
    maxWidth,
  );

  return {
    ...preference,
    [pane]: {
      ...preference[pane],
      width: nextWidth,
    },
  };
};

export const isCollapseArmed = (
  pane: ResizablePane,
  requestedWidth: number,
  minimumWidth: number = getPaneConfig(pane).minWidth,
): boolean => {
  return isFiniteNumber(requestedWidth)
    && requestedWidth <= minimumWidth - PANE_LAYOUT.collapseThreshold;
};

export const shouldCollapseAfterDrag = (
  endReason: DragEndReason,
  collapseArmed: boolean,
): boolean => endReason === 'pointerup' && collapseArmed;

export const collapsePanePreference = (
  inputPreference: PaneLayoutPreference,
  pane: ResizablePane,
  lastExpandedWidth: number,
): PaneLayoutPreference => {
  const preference = normalizePaneLayoutPreference(inputPreference);
  const config = getPaneConfig(pane);
  const savedWidth = clamp(
    isFiniteNumber(lastExpandedWidth) ? lastExpandedWidth : preference[pane].width,
    config.minWidth,
    getStoredMaximumWidth(pane),
  );

  return {
    ...preference,
    [pane]: {
      width: savedWidth,
      collapsed: true,
    },
  };
};

export const restorePanePreference = (
  inputPreference: PaneLayoutPreference,
  pane: ResizablePane,
): PaneLayoutPreference => {
  const preference = normalizePaneLayoutPreference(inputPreference);

  return {
    ...preference,
    [pane]: {
      ...preference[pane],
      collapsed: false,
    },
  };
};

const parseVersionOne = (value: Record<string, unknown>): PaneLayoutPreference | null => {
  const feedWidth = value.feedWidth;
  const entryWidth = value.entryWidth;
  if (!isFiniteNumber(feedWidth) || !isFiniteNumber(entryWidth)) {
    return null;
  }

  return normalizePaneLayoutPreference({
    version: PANE_LAYOUT.version,
    feed: {
      width: feedWidth,
      collapsed: false,
    },
    entry: {
      width: entryWidth,
      collapsed: false,
    },
  });
};

const parseVersionTwo = (value: Record<string, unknown>): PaneLayoutPreference | null => {
  if (!isRecord(value.feed) || !isRecord(value.entry)) {
    return null;
  }

  const feed = value.feed;
  const entry = value.entry;
  if (
    !isFiniteNumber(feed.width)
    || typeof feed.collapsed !== 'boolean'
    || !isFiniteNumber(entry.width)
    || typeof entry.collapsed !== 'boolean'
  ) {
    return null;
  }

  return normalizePaneLayoutPreference({
    version: PANE_LAYOUT.version,
    feed: {
      width: feed.width,
      collapsed: feed.collapsed,
    },
    entry: {
      width: entry.width,
      collapsed: entry.collapsed,
    },
  });
};

export const parseStoredPaneLayoutPreference = (
  rawValue: string | null,
): PaneLayoutPreference => {
  if (!rawValue) {
    return getDefaultPaneLayoutPreference();
  }

  try {
    const parsedValue: unknown = JSON.parse(rawValue);
    if (!isRecord(parsedValue) || !isFiniteNumber(parsedValue.version)) {
      return getDefaultPaneLayoutPreference();
    }

    if (parsedValue.version === 1) {
      return parseVersionOne(parsedValue) ?? getDefaultPaneLayoutPreference();
    }

    if (parsedValue.version === PANE_LAYOUT.version) {
      return parseVersionTwo(parsedValue) ?? getDefaultPaneLayoutPreference();
    }

    return getDefaultPaneLayoutPreference();
  } catch {
    return getDefaultPaneLayoutPreference();
  }
};

const isVersionOneStoredLayout = (rawValue: string | null): boolean => {
  if (!rawValue) return false;

  try {
    const parsedValue: unknown = JSON.parse(rawValue);
    return isRecord(parsedValue) && parsedValue.version === 1;
  } catch {
    return false;
  }
};

export const loadPaneLayoutPreference = (): PaneLayoutPreference => {
  try {
    const rawValue = window.localStorage.getItem(PANE_LAYOUT.storageKey);
    const preference = parseStoredPaneLayoutPreference(rawValue);

    if (isVersionOneStoredLayout(rawValue)) {
      try {
        window.localStorage.setItem(PANE_LAYOUT.storageKey, JSON.stringify(preference));
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
      PANE_LAYOUT.storageKey,
      JSON.stringify(normalizePaneLayoutPreference(preference)),
    );
  } catch {
    // Storage can be disabled or full; layout persistence must not block reading.
  }
};
