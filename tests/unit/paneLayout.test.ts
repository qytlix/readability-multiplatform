import { describe, expect, it } from 'vitest';
import {
  PANE_LAYOUT,
  constrainPaneWidths,
  getDefaultPaneWidths,
  getMinimumWorkspaceWidth,
  getPaneBounds,
  parseStoredPaneWidths,
  resizePane,
} from '../../src/renderer/features/layout/paneLayout';

describe('pane layout sizing', () => {
  it('keeps all three panes usable at the temporary minimum workspace width', () => {
    const widths = constrainPaneWidths(getDefaultPaneWidths(), 1100);
    const readerWidth = 1100
      - widths.feedWidth
      - widths.entryWidth
      - PANE_LAYOUT.dividerWidth * 2;

    expect(widths).toEqual({ feedWidth: 224, entryWidth: 384 });
    expect(readerWidth).toBe(PANE_LAYOUT.readerMinWidth);
  });

  it('falls back to the minimum viable workspace for invalid container widths', () => {
    const widths = constrainPaneWidths(
      { feedWidth: Number.NaN, entryWidth: Number.POSITIVE_INFINITY },
      Number.NaN,
    );

    expect(widths).toEqual({
      feedWidth: PANE_LAYOUT.feed.minWidth,
      entryWidth: PANE_LAYOUT.entry.minWidth,
    });
    expect(getMinimumWorkspaceWidth()).toBe(1068);
  });

  it('limits a dragged pane before it would shrink the reader below its minimum', () => {
    const currentWidths = { feedWidth: 340, entryWidth: 400 };
    const resizedWidths = resizePane('entry', 560, currentWidths, 1280);

    expect(resizedWidths).toEqual({ feedWidth: 340, entryWidth: 448 });
    expect(getPaneBounds('entry', 340, 1280)).toEqual({
      minWidth: 360,
      maxWidth: 448,
    });
  });

  it('applies the pane minimums and maximums at normal and wide desktop widths', () => {
    const baselineWidths = constrainPaneWidths(getDefaultPaneWidths(), 1280);
    const feedAtMinimum = resizePane('feed', 0, baselineWidths, 1280);
    const entryAtMinimum = resizePane('entry', 0, baselineWidths, 1280);
    const feedAtMaximum = resizePane('feed', 999, baselineWidths, 1600);
    const entryAtMaximum = resizePane('entry', 999, feedAtMaximum, 1600);

    expect(baselineWidths).toEqual({ feedWidth: 224, entryWidth: 400 });
    expect(feedAtMinimum.feedWidth).toBe(PANE_LAYOUT.feed.minWidth);
    expect(entryAtMinimum.entryWidth).toBe(PANE_LAYOUT.entry.minWidth);
    expect(feedAtMaximum.feedWidth).toBe(PANE_LAYOUT.feed.maxWidth);
    expect(entryAtMaximum.entryWidth).toBe(PANE_LAYOUT.entry.maxWidth);
  });

  it('parses only the current, valid version of the stored layout object', () => {
    expect(parseStoredPaneWidths('{"version":1,"feedWidth":300,"entryWidth":500}')).toEqual({
      feedWidth: 300,
      entryWidth: 500,
    });
    expect(parseStoredPaneWidths('{"version":2,"feedWidth":300,"entryWidth":500}')).toEqual(
      getDefaultPaneWidths(),
    );
    expect(parseStoredPaneWidths('{"version":1,"feedWidth":-1,"entryWidth":900}')).toEqual({
      feedWidth: PANE_LAYOUT.feed.minWidth,
      entryWidth: PANE_LAYOUT.entry.maxWidth,
    });
    expect(parseStoredPaneWidths('{not valid json')).toEqual(getDefaultPaneWidths());
  });
});
