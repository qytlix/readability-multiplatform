import {
  PANE_LAYOUT,
  getOtherPane,
  getPaneConfig,
  isFiniteNumber,
  normalizePaneLayoutPreference,
  type PaneLayoutPreference,
  type PaneTrackLayout,
  type ResizablePane,
} from './paneLayoutModel';

export const getMinimumWorkspaceWidth = (): number =>
  PANE_LAYOUT.feed.minWidth
  + PANE_LAYOUT.entry.minWidth
  + PANE_LAYOUT.readerMinWidth
  + PANE_LAYOUT.dividerWidth * 2;

const getSafeContainerWidth = (containerWidth: number): number =>
  isFiniteNumber(containerWidth) && containerWidth > 0
    ? containerWidth
    : getMinimumWorkspaceWidth();

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
  let feedExpandedWidth = preference.feed.width;
  let entryExpandedWidth = preference.entry.width;
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
  const config = getPaneConfig(pane);
  const otherPane = getOtherPane(pane);
  const otherTrack = tracks[otherPane];
  const occupiedWidth = tracks.readerMinWidth
    + PANE_LAYOUT.dividerWidth
    + (otherTrack.collapsed
      ? PANE_LAYOUT.collapsedRailWidth
      : otherTrack.expandedWidth + PANE_LAYOUT.dividerWidth);
  const dynamicMaximum = getSafeContainerWidth(containerWidth) - occupiedWidth;

  return {
    minWidth: config.minWidth,
    maxWidth: Math.max(config.minWidth, Math.min(config.maxWidth, dynamicMaximum)),
  };
};
