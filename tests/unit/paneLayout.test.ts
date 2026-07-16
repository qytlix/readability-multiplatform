import { describe, expect, it } from 'vitest';
import {
  PANE_LAYOUT,
  collapsePanePreference,
  getDefaultPaneLayoutPreference,
  getPaneTrackLayout,
  isCollapseArmed,
  parseStoredPaneLayoutPreference,
  resizePanePreference,
  restorePanePreference,
  shouldCollapseAfterDrag,
} from '../../src/renderer/features/layout/paneLayout';

describe('pane layout preferences', () => {
  it('migrates the phase-one v1 preference without losing saved widths', () => {
    expect(
      parseStoredPaneLayoutPreference('{"version":1,"feedWidth":300,"entryWidth":500}'),
    ).toEqual({
      version: 2,
      feed: { width: 300, collapsed: false },
      entry: { width: 500, collapsed: false },
    });
  });

  it('accepts v2 collapsed preferences and safely rejects unknown or damaged data', () => {
    expect(
      parseStoredPaneLayoutPreference(
        '{"version":2,"feed":{"width":280,"collapsed":true},"entry":{"width":440,"collapsed":false}}',
      ),
    ).toEqual({
      version: 2,
      feed: { width: 280, collapsed: true },
      entry: { width: 440, collapsed: false },
    });
    expect(
      parseStoredPaneLayoutPreference('{"version":3,"feedWidth":280,"entryWidth":440}'),
    ).toEqual(getDefaultPaneLayoutPreference());
    expect(
      parseStoredPaneLayoutPreference(
        '{"version":2,"feed":{"width":"bad","collapsed":false},"entry":{"width":440,"collapsed":false}}',
      ),
    ).toEqual(getDefaultPaneLayoutPreference());
  });

  it('arms Feed collapse only after the threshold and only collapses on pointerup', () => {
    expect(isCollapseArmed('feed', PANE_LAYOUT.feed.minWidth - 43)).toBe(false);
    expect(isCollapseArmed('feed', PANE_LAYOUT.feed.minWidth - 44)).toBe(true);
    expect(isCollapseArmed('feed', PANE_LAYOUT.feed.minWidth - 10)).toBe(false);
    expect(shouldCollapseAfterDrag('pointerup', true)).toBe(true);
    expect(shouldCollapseAfterDrag('pointerup', false)).toBe(false);
    expect(shouldCollapseAfterDrag('pointercancel', true)).toBe(false);
    expect(shouldCollapseAfterDrag('windowblur', true)).toBe(false);
  });

  it('uses the same threshold rules for Entry and does not collapse after lost capture', () => {
    expect(isCollapseArmed('entry', PANE_LAYOUT.entry.minWidth - 43)).toBe(false);
    expect(isCollapseArmed('entry', PANE_LAYOUT.entry.minWidth - 44)).toBe(true);
    expect(shouldCollapseAfterDrag('lostpointercapture', true)).toBe(false);
  });

  it('preserves the last expanded width through collapse and restores it', () => {
    const collapsed = collapsePanePreference(
      getDefaultPaneLayoutPreference(),
      'feed',
      288,
    );
    const restored = restorePanePreference(collapsed, 'feed');
    const restoredTracks = getPaneTrackLayout(restored, 1280);

    expect(collapsed.feed).toEqual({ width: 288, collapsed: true });
    expect(restored.feed).toEqual({ width: 288, collapsed: false });
    expect(restoredTracks.feed.trackWidth).toBe(288);
  });

  it('uses the rail and removes the ordinary divider for a collapsed pane', () => {
    const collapsed = collapsePanePreference(
      getDefaultPaneLayoutPreference(),
      'feed',
      280,
    );
    const tracks = getPaneTrackLayout(collapsed, 1280);

    expect(tracks.feed).toMatchObject({
      collapsed: true,
      trackWidth: PANE_LAYOUT.collapsedRailWidth,
      dividerWidth: 0,
    });
    expect(tracks.entry.collapsed).toBe(false);
    expect(tracks.entry.dividerWidth).toBe(PANE_LAYOUT.dividerWidth);
  });

  it('clamps expanded panes before the Reader falls below 480px', () => {
    const preference = {
      version: PANE_LAYOUT.version,
      feed: { width: 340, collapsed: false },
      entry: { width: 560, collapsed: false },
    };
    const tracks = getPaneTrackLayout(preference, 1100);
    const readerWidth = 1100
      - tracks.feed.trackWidth
      - tracks.feed.dividerWidth
      - tracks.entry.trackWidth
      - tracks.entry.dividerWidth;

    expect(readerWidth).toBe(PANE_LAYOUT.readerMinWidth);
    expect(tracks.entry.expandedWidth).toBe(PANE_LAYOUT.entry.minWidth);
    expect(tracks.feed.expandedWidth).toBe(248);
  });

  it('uses the actual container width without mutating oversized persisted preferences', () => {
    const preference = {
      version: PANE_LAYOUT.version,
      feed: { width: 340, collapsed: false },
      entry: { width: 560, collapsed: false },
    };
    const tracks = getPaneTrackLayout(preference, 1024);
    const readerWidth = 1024
      - tracks.feed.trackWidth
      - tracks.feed.dividerWidth
      - tracks.entry.trackWidth
      - tracks.entry.dividerWidth;

    expect(tracks.feed.expandedWidth).toBe(PANE_LAYOUT.feed.minWidth);
    expect(tracks.entry.expandedWidth).toBe(PANE_LAYOUT.entry.minWidth);
    expect(tracks.readerMinWidth).toBe(436);
    expect(readerWidth).toBe(436);
    expect(preference).toEqual({
      version: PANE_LAYOUT.version,
      feed: { width: 340, collapsed: false },
      entry: { width: 560, collapsed: false },
    });
  });

  it('gives all extra desktop width to Reader instead of expanding persisted pane widths', () => {
    const preference = {
      version: PANE_LAYOUT.version,
      feed: { width: 340, collapsed: false },
      entry: { width: 560, collapsed: false },
    };
    const tracks = getPaneTrackLayout(preference, 3440);
    const readerWidth = 3440
      - tracks.feed.trackWidth
      - tracks.feed.dividerWidth
      - tracks.entry.trackWidth
      - tracks.entry.dividerWidth;

    expect(tracks.feed.expandedWidth).toBe(340);
    expect(tracks.entry.expandedWidth).toBe(560);
    expect(readerWidth).toBe(2528);
  });

  it('keeps a collapsed rail stable while the remaining pane is clamped', () => {
    const preference = {
      version: PANE_LAYOUT.version,
      feed: { width: 340, collapsed: true },
      entry: { width: 560, collapsed: false },
    };
    const tracks = getPaneTrackLayout(preference, 1024);
    const readerWidth = 1024
      - tracks.feed.trackWidth
      - tracks.feed.dividerWidth
      - tracks.entry.trackWidth
      - tracks.entry.dividerWidth;

    expect(tracks.feed).toMatchObject({
      collapsed: true,
      trackWidth: PANE_LAYOUT.collapsedRailWidth,
      dividerWidth: 0,
    });
    expect(tracks.entry.expandedWidth).toBe(504);
    expect(readerWidth).toBe(PANE_LAYOUT.readerMinWidth);
    expect(preference.feed.collapsed).toBe(true);
  });

  it.each([1024, 1100, 1280, 1440, 1707, 1920, 2560, 3440])(
    'keeps all five tracks within a %ipx workspace',
    (containerWidth) => {
      const tracks = getPaneTrackLayout({
        version: PANE_LAYOUT.version,
        feed: { width: 340, collapsed: false },
        entry: { width: 560, collapsed: false },
      }, containerWidth);
      const usedWidth = tracks.feed.trackWidth
        + tracks.feed.dividerWidth
        + tracks.entry.trackWidth
        + tracks.entry.dividerWidth;
      const readerWidth = containerWidth - usedWidth;

      expect(usedWidth).toBeLessThanOrEqual(containerWidth);
      expect(readerWidth).toBeGreaterThanOrEqual(0);
    },
  );

  it('keeps two independent rails when both panes are collapsed', () => {
    const feedCollapsed = collapsePanePreference(
      getDefaultPaneLayoutPreference(),
      'feed',
      280,
    );
    const bothCollapsed = collapsePanePreference(feedCollapsed, 'entry', 440);
    const tracks = getPaneTrackLayout(bothCollapsed, 1100);

    expect(tracks.feed).toMatchObject({
      collapsed: true,
      trackWidth: PANE_LAYOUT.collapsedRailWidth,
      dividerWidth: 0,
    });
    expect(tracks.entry).toMatchObject({
      collapsed: true,
      trackWidth: PANE_LAYOUT.collapsedRailWidth,
      dividerWidth: 0,
    });
  });

  it('restores a width through the normal safe resize clamp', () => {
    const restored = restorePanePreference(
      collapsePanePreference(getDefaultPaneLayoutPreference(), 'entry', 560),
      'entry',
    );
    const resized = resizePanePreference('entry', restored.entry.width, restored, 1100);

    expect(resized.entry.width).toBe(384);
  });
});
