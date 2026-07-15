export const PANE_LAYOUT = {
  storageKey: 'shale.workspace-layout',
  version: 1,
  dividerWidth: 6,
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

export interface PaneWidths {
  feedWidth: number;
  entryWidth: number;
}

interface StoredPaneLayout extends PaneWidths {
  version: number;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const getStaticPaneBounds = (pane: ResizablePane) =>
  pane === 'feed' ? PANE_LAYOUT.feed : PANE_LAYOUT.entry;

export const getDefaultPaneWidths = (): PaneWidths => ({
  feedWidth: PANE_LAYOUT.feed.defaultWidth,
  entryWidth: PANE_LAYOUT.entry.defaultWidth,
});

export const getMinimumWorkspaceWidth = (): number =>
  PANE_LAYOUT.feed.minWidth
  + PANE_LAYOUT.entry.minWidth
  + PANE_LAYOUT.readerMinWidth
  + PANE_LAYOUT.dividerWidth * 2;

const getSafeContainerWidth = (containerWidth: number): number =>
  isFiniteNumber(containerWidth) && containerWidth > 0
    ? Math.max(containerWidth, getMinimumWorkspaceWidth())
    : getMinimumWorkspaceWidth();

export const normalizePaneWidths = (widths: PaneWidths): PaneWidths => ({
  feedWidth: clamp(
    isFiniteNumber(widths.feedWidth) ? widths.feedWidth : PANE_LAYOUT.feed.defaultWidth,
    PANE_LAYOUT.feed.minWidth,
    PANE_LAYOUT.feed.maxWidth,
  ),
  entryWidth: clamp(
    isFiniteNumber(widths.entryWidth) ? widths.entryWidth : PANE_LAYOUT.entry.defaultWidth,
    PANE_LAYOUT.entry.minWidth,
    PANE_LAYOUT.entry.maxWidth,
  ),
});

/**
 * Resolves saved preferred widths for the available Grid width without mutating
 * the saved preference. At narrow desktop widths, the Entry pane gives up its
 * optional width first, then the Feed pane, so the Reader retains its minimum.
 */
export const constrainPaneWidths = (
  preferredWidths: PaneWidths,
  containerWidth: number,
): PaneWidths => {
  let { feedWidth, entryWidth } = normalizePaneWidths(preferredWidths);
  const availablePaneWidth = getSafeContainerWidth(containerWidth)
    - PANE_LAYOUT.readerMinWidth
    - PANE_LAYOUT.dividerWidth * 2;
  let excessWidth = feedWidth + entryWidth - availablePaneWidth;

  if (excessWidth <= 0) {
    return { feedWidth, entryWidth };
  }

  const entryReduction = Math.min(
    excessWidth,
    entryWidth - PANE_LAYOUT.entry.minWidth,
  );
  entryWidth -= entryReduction;
  excessWidth -= entryReduction;

  if (excessWidth > 0) {
    feedWidth = Math.max(PANE_LAYOUT.feed.minWidth, feedWidth - excessWidth);
  }

  return { feedWidth, entryWidth };
};

export const getPaneBounds = (
  pane: ResizablePane,
  otherPaneWidth: number,
  containerWidth: number,
): { minWidth: number; maxWidth: number } => {
  const bounds = getStaticPaneBounds(pane);
  const dynamicMaximum = getSafeContainerWidth(containerWidth)
    - otherPaneWidth
    - PANE_LAYOUT.readerMinWidth
    - PANE_LAYOUT.dividerWidth * 2;

  return {
    minWidth: bounds.minWidth,
    maxWidth: Math.max(
      bounds.minWidth,
      Math.min(bounds.maxWidth, dynamicMaximum),
    ),
  };
};

export const resizePane = (
  pane: ResizablePane,
  requestedWidth: number,
  currentWidths: PaneWidths,
  containerWidth: number,
): PaneWidths => {
  const otherPaneWidth = pane === 'feed'
    ? currentWidths.entryWidth
    : currentWidths.feedWidth;
  const { minWidth, maxWidth } = getPaneBounds(
    pane,
    otherPaneWidth,
    containerWidth,
  );
  const fallbackWidth = pane === 'feed'
    ? currentWidths.feedWidth
    : currentWidths.entryWidth;
  const nextWidth = clamp(
    isFiniteNumber(requestedWidth) ? requestedWidth : fallbackWidth,
    minWidth,
    maxWidth,
  );

  return pane === 'feed'
    ? { ...currentWidths, feedWidth: nextWidth }
    : { ...currentWidths, entryWidth: nextWidth };
};

export const parseStoredPaneWidths = (rawValue: string | null): PaneWidths => {
  if (!rawValue) {
    return getDefaultPaneWidths();
  }

  try {
    const parsedValue: unknown = JSON.parse(rawValue);
    if (
      !parsedValue
      || typeof parsedValue !== 'object'
      || !('version' in parsedValue)
      || !('feedWidth' in parsedValue)
      || !('entryWidth' in parsedValue)
    ) {
      return getDefaultPaneWidths();
    }

    const storedLayout = parsedValue as StoredPaneLayout;
    if (
      storedLayout.version !== PANE_LAYOUT.version
      || !isFiniteNumber(storedLayout.feedWidth)
      || !isFiniteNumber(storedLayout.entryWidth)
    ) {
      return getDefaultPaneWidths();
    }

    return normalizePaneWidths(storedLayout);
  } catch {
    return getDefaultPaneWidths();
  }
};

export const loadPaneWidths = (): PaneWidths => {
  try {
    return parseStoredPaneWidths(window.localStorage.getItem(PANE_LAYOUT.storageKey));
  } catch {
    return getDefaultPaneWidths();
  }
};

export const savePaneWidths = (widths: PaneWidths): void => {
  const normalizedWidths = normalizePaneWidths(widths);
  const storedLayout: StoredPaneLayout = {
    version: PANE_LAYOUT.version,
    ...normalizedWidths,
  };

  try {
    window.localStorage.setItem(PANE_LAYOUT.storageKey, JSON.stringify(storedLayout));
  } catch {
    // Storage can be disabled or full; layout persistence must not block reading.
  }
};
