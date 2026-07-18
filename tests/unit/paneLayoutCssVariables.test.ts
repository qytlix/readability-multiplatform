import { describe, expect, it } from 'vitest';
import {
  getWorkspaceCssVariables,
} from '../../src/renderer/features/layout/paneLayoutCssVariables';
import type { PaneTrackLayout } from '../../src/renderer/features/layout/paneLayoutModel';

describe('workspace CSS variable mapping', () => {
  it('maps expanded pane tracks to pixel CSS variables', () => {
    const tracks: PaneTrackLayout = {
      feed: {
        collapsed: false,
        expandedWidth: 224,
        trackWidth: 224,
        dividerWidth: 6,
      },
      entry: {
        collapsed: false,
        expandedWidth: 400,
        trackWidth: 400,
        dividerWidth: 6,
      },
      readerMinWidth: 480,
    };

    expect(getWorkspaceCssVariables(tracks)).toEqual({
      '--workspace-feed-width': '224px',
      '--workspace-feed-divider-width': '6px',
      '--workspace-entry-width': '400px',
      '--workspace-entry-divider-width': '6px',
    });
  });

  it('maps collapsed rails and removed dividers to their effective CSS variables', () => {
    const tracks: PaneTrackLayout = {
      feed: {
        collapsed: true,
        expandedWidth: 280,
        trackWidth: 34,
        dividerWidth: 0,
      },
      entry: {
        collapsed: true,
        expandedWidth: 440,
        trackWidth: 34,
        dividerWidth: 0,
      },
      readerMinWidth: 480,
    };

    expect(getWorkspaceCssVariables(tracks)).toEqual({
      '--workspace-feed-width': '34px',
      '--workspace-feed-divider-width': '0px',
      '--workspace-entry-width': '34px',
      '--workspace-entry-divider-width': '0px',
    });
  });
});
