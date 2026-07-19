import type { PaneTrackLayout } from './paneLayoutModel';

export interface WorkspaceCssVariables {
  '--workspace-feed-width': string;
  '--workspace-feed-divider-width': string;
  '--workspace-entry-width': string;
  '--workspace-entry-divider-width': string;
}

export const getWorkspaceCssVariables = (
  tracks: PaneTrackLayout,
): WorkspaceCssVariables => ({
  '--workspace-feed-width': `${tracks.feed.trackWidth}px`,
  '--workspace-feed-divider-width': `${tracks.feed.dividerWidth}px`,
  '--workspace-entry-width': `${tracks.entry.trackWidth}px`,
  '--workspace-entry-divider-width': `${tracks.entry.dividerWidth}px`,
});

export const writeWorkspaceCssVariables = (
  element: HTMLElement,
  tracks: PaneTrackLayout,
): void => {
  const variables = getWorkspaceCssVariables(tracks);

  element.style.setProperty('--workspace-feed-width', variables['--workspace-feed-width']);
  element.style.setProperty(
    '--workspace-feed-divider-width',
    variables['--workspace-feed-divider-width'],
  );
  element.style.setProperty('--workspace-entry-width', variables['--workspace-entry-width']);
  element.style.setProperty(
    '--workspace-entry-divider-width',
    variables['--workspace-entry-divider-width'],
  );
};
