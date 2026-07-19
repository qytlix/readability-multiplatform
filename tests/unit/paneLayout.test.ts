import { describe, expect, it } from 'vitest';
import {
  PANE_LAYOUT,
  collapsePanePreference,
  getDefaultPaneLayoutPreference,
  getPaneBounds,
  getPaneBoundsFromTracks,
  getPaneTrackLayout,
  isCollapseArmed,
  parseStoredPaneLayoutPreference,
  resolvePaneResizeIntent,
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
      feed: { preferredWidth: 300, collapsed: false },
      entry: { preferredWidth: 500, collapsed: false },
    });
  });

  it('accepts v2 collapsed preferences and safely rejects unknown or damaged data', () => {
    expect(
      parseStoredPaneLayoutPreference(
        '{"version":2,"feed":{"width":280,"collapsed":true},"entry":{"width":440,"collapsed":false}}',
      ),
    ).toEqual({
      version: 2,
      feed: { preferredWidth: 280, collapsed: true },
      entry: { preferredWidth: 440, collapsed: false },
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

  it('preserves the preferred width through collapse and restores it', () => {
    const preference = {
      version: PANE_LAYOUT.version,
      feed: { preferredWidth: 288, collapsed: false },
      entry: { preferredWidth: 400, collapsed: false },
    };
    const collapsed = collapsePanePreference(
      preference,
      'feed',
    );
    const restored = restorePanePreference(collapsed, 'feed');
    const restoredTracks = getPaneTrackLayout(restored, 1280);

    expect(collapsed.feed).toEqual({ preferredWidth: 288, collapsed: true });
    expect(restored.feed).toEqual({ preferredWidth: 288, collapsed: false });
    expect(restoredTracks.feed.trackWidth).toBe(288);
  });

  it('uses the rail and removes the ordinary divider for a collapsed pane', () => {
    const collapsed = collapsePanePreference(
      getDefaultPaneLayoutPreference(),
      'feed',
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
      feed: { preferredWidth: 340, collapsed: false },
      entry: { preferredWidth: 560, collapsed: false },
    };
    const tracks = getPaneTrackLayout(preference, 1100);
    const readerWidth = 1100
      - tracks.feed.trackWidth
      - tracks.feed.dividerWidth
      - tracks.entry.trackWidth
      - tracks.entry.dividerWidth;

    expect(readerWidth).toBe(PANE_LAYOUT.readerMinWidth);
    expect(tracks.entry.effectiveWidth).toBe(PANE_LAYOUT.entry.minWidth);
    expect(tracks.feed.effectiveWidth).toBe(248);
  });

  it('uses the actual container width without mutating preferred widths', () => {
    const preference = {
      version: PANE_LAYOUT.version,
      feed: { preferredWidth: 340, collapsed: false },
      entry: { preferredWidth: 560, collapsed: false },
    };
    const tracks = getPaneTrackLayout(preference, 1024);
    const widenedTracks = getPaneTrackLayout(preference, 1440);
    const readerWidth = 1024
      - tracks.feed.trackWidth
      - tracks.feed.dividerWidth
      - tracks.entry.trackWidth
      - tracks.entry.dividerWidth;

    expect(tracks.feed.effectiveWidth).toBe(PANE_LAYOUT.feed.minWidth);
    expect(tracks.entry.effectiveWidth).toBe(PANE_LAYOUT.entry.minWidth);
    expect(tracks.readerMinWidth).toBe(436);
    expect(readerWidth).toBe(436);
    expect(preference).toEqual({
      version: PANE_LAYOUT.version,
      feed: { preferredWidth: 340, collapsed: false },
      entry: { preferredWidth: 560, collapsed: false },
    });
    expect(widenedTracks.feed.effectiveWidth).toBe(preference.feed.preferredWidth);
    expect(widenedTracks.entry.effectiveWidth).toBe(preference.entry.preferredWidth);
  });

  it('keeps effective widths equal to preferred widths in a wide workspace', () => {
    const preference = {
      version: PANE_LAYOUT.version,
      feed: { preferredWidth: 340, collapsed: false },
      entry: { preferredWidth: 560, collapsed: false },
    };
    const tracks = getPaneTrackLayout(preference, 3440);
    const readerWidth = 3440
      - tracks.feed.trackWidth
      - tracks.feed.dividerWidth
      - tracks.entry.trackWidth
      - tracks.entry.dividerWidth;

    expect(tracks.feed.effectiveWidth).toBe(preference.feed.preferredWidth);
    expect(tracks.entry.effectiveWidth).toBe(preference.entry.preferredWidth);
    expect(readerWidth).toBe(2528);
  });

  it('keeps a collapsed rail stable while the remaining pane is clamped', () => {
    const preference = {
      version: PANE_LAYOUT.version,
      feed: { preferredWidth: 340, collapsed: true },
      entry: { preferredWidth: 560, collapsed: false },
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
    expect(tracks.entry.effectiveWidth).toBe(504);
    expect(readerWidth).toBe(PANE_LAYOUT.readerMinWidth);
    expect(preference.feed.collapsed).toBe(true);
  });

  it('returns a no-op for a constrained Feed resize that has no effective movement', () => {
    const preference = {
      version: PANE_LAYOUT.version,
      feed: { preferredWidth: 340, collapsed: false },
      entry: { preferredWidth: 560, collapsed: false },
    };
    const resizeIntent = resolvePaneResizeIntent({
      preference,
      pane: 'feed',
      requestedEffectiveWidth: 260,
      containerWidth: 1024,
    });

    expect(resizeIntent.effectiveWidthChanged).toBe(false);
    expect(resizeIntent.nextPreference).toEqual(preference);
    expect(resizeIntent.tracks.feed.effectiveWidth).toBe(PANE_LAYOUT.feed.minWidth);
  });

  it('returns a no-op for a constrained Entry resize that has no effective movement', () => {
    const preference = {
      version: PANE_LAYOUT.version,
      feed: { preferredWidth: 340, collapsed: false },
      entry: { preferredWidth: 560, collapsed: false },
    };
    const resizeIntent = resolvePaneResizeIntent({
      preference,
      pane: 'entry',
      requestedEffectiveWidth: 400,
      containerWidth: 1024,
    });

    expect(resizeIntent.effectiveWidthChanged).toBe(false);
    expect(resizeIntent.nextPreference).toEqual(preference);
    expect(resizeIntent.tracks.entry.effectiveWidth).toBe(PANE_LAYOUT.entry.minWidth);
  });

  it('uses a visible effective width as the new preferred width', () => {
    const preference = {
      version: PANE_LAYOUT.version,
      feed: { preferredWidth: 340, collapsed: false },
      entry: { preferredWidth: 560, collapsed: false },
    };
    const resizeIntent = resolvePaneResizeIntent({
      preference,
      pane: 'feed',
      requestedEffectiveWidth: 220,
      containerWidth: 1100,
    });

    expect(resizeIntent.effectiveWidthChanged).toBe(true);
    expect(resizeIntent.tracks.feed.effectiveWidth).toBe(220);
    expect(resizeIntent.nextPreference.feed.preferredWidth).toBe(220);
  });

  it('saves the effective boundary width when a requested resize visibly reaches it', () => {
    const preference = {
      version: PANE_LAYOUT.version,
      feed: { preferredWidth: 340, collapsed: false },
      entry: { preferredWidth: 560, collapsed: false },
    };
    const resizeIntent = resolvePaneResizeIntent({
      preference,
      pane: 'feed',
      requestedEffectiveWidth: 0,
      containerWidth: 1100,
    });

    expect(resizeIntent.effectiveWidthChanged).toBe(true);
    expect(resizeIntent.tracks.feed.effectiveWidth).toBe(PANE_LAYOUT.feed.minWidth);
    expect(resizeIntent.nextPreference.feed.preferredWidth).toBe(PANE_LAYOUT.feed.minWidth);
  });

  it('returns a no-op when a drag finishes at its starting effective width', () => {
    const preference = {
      version: PANE_LAYOUT.version,
      feed: { preferredWidth: 340, collapsed: false },
      entry: { preferredWidth: 560, collapsed: false },
    };
    const startingTracks = getPaneTrackLayout(preference, 1100);
    const movedIntent = resolvePaneResizeIntent({
      preference,
      pane: 'feed',
      requestedEffectiveWidth: 220,
      containerWidth: 1100,
    });
    const returnedIntent = resolvePaneResizeIntent({
      preference,
      pane: 'feed',
      requestedEffectiveWidth: startingTracks.feed.effectiveWidth,
      containerWidth: 1100,
    });

    expect(movedIntent.effectiveWidthChanged).toBe(true);
    expect(returnedIntent.effectiveWidthChanged).toBe(false);
    expect(returnedIntent.nextPreference).toEqual(preference);
    expect(returnedIntent.tracks).toEqual(startingTracks);
  });

  it.each([1024, 1100, 1280, 1440, 1707, 1920, 2560, 3440])(
    'keeps all five tracks within a %ipx workspace',
    (containerWidth) => {
      const tracks = getPaneTrackLayout({
        version: PANE_LAYOUT.version,
        feed: { preferredWidth: 340, collapsed: false },
        entry: { preferredWidth: 560, collapsed: false },
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
    );
    const bothCollapsed = collapsePanePreference(feedCollapsed, 'entry');
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

  it.each([
    [
      'a wide workspace',
      'feed',
      getDefaultPaneLayoutPreference(),
      1440,
    ],
    [
      'a constrained workspace',
      'entry',
      {
        version: PANE_LAYOUT.version,
        feed: { preferredWidth: 340, collapsed: false },
        entry: { preferredWidth: 560, collapsed: false },
      },
      1100,
    ],
    [
      'a collapsed pane',
      'feed',
      {
        version: PANE_LAYOUT.version,
        feed: { preferredWidth: 280, collapsed: true },
        entry: { preferredWidth: 440, collapsed: false },
      },
      1280,
    ],
  ] as const)(
    'returns equivalent bounds from resolved tracks in %s',
    (_scenario, pane, preference, containerWidth) => {
      const tracks = getPaneTrackLayout(preference, containerWidth);

      expect(getPaneBoundsFromTracks(tracks, pane, containerWidth)).toEqual(
        getPaneBounds(pane, preference, containerWidth),
      );
    },
  );

  it('keeps the drag-start preferred width when a constrained pane collapses', () => {
    const dragStartPreference = {
      version: PANE_LAYOUT.version,
      feed: { preferredWidth: 340, collapsed: false },
      entry: { preferredWidth: 560, collapsed: false },
    };
    const constrainedTracks = getPaneTrackLayout(dragStartPreference, 1024);
    const collapsed = collapsePanePreference(dragStartPreference, 'feed');
    const restored = restorePanePreference(collapsed, 'feed');

    expect(constrainedTracks.feed.effectiveWidth).toBe(PANE_LAYOUT.feed.minWidth);
    expect(collapsed.feed).toEqual({ preferredWidth: 340, collapsed: true });
    expect(restored.feed).toEqual({ preferredWidth: 340, collapsed: false });
    expect(getPaneTrackLayout(restored, 1440).feed.effectiveWidth).toBe(340);
  });

  it('restores a preferred width through the normal safe resize clamp', () => {
    const restored = restorePanePreference(
      collapsePanePreference(getDefaultPaneLayoutPreference(), 'entry'),
      'entry',
    );
    const resized = resizePanePreference(
      'entry',
      restored.entry.preferredWidth,
      restored,
      1100,
    );

    expect(resized.entry.preferredWidth).toBe(384);
  });
});
