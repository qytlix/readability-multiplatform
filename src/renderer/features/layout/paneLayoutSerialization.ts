import {
  PANE_LAYOUT,
  getDefaultPaneLayoutPreference,
  isFiniteNumber,
  normalizePaneLayoutPreference,
  type PaneLayoutPreference,
} from './paneLayoutModel';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

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

export const isVersionOneStoredLayout = (rawValue: string | null): boolean => {
  if (!rawValue) return false;

  try {
    const parsedValue: unknown = JSON.parse(rawValue);
    return isRecord(parsedValue) && parsedValue.version === 1;
  } catch {
    return false;
  }
};
