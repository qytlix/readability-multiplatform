import {
  PANE_LAYOUT,
  clamp,
  getPaneConfig,
  isFiniteNumber,
  normalizePaneLayoutPreference,
  type DragEndReason,
  type PaneLayoutPreference,
  type PaneTrackLayout,
  type ResizablePane,
} from './paneLayoutModel';
import { getPaneBounds, getPaneTrackLayout } from './paneLayoutGeometry';

export interface PaneResizeIntentInput {
  preference: PaneLayoutPreference;
  pane: ResizablePane;
  requestedEffectiveWidth: number;
  containerWidth: number;
}

export interface PaneResizeIntent {
  tracks: PaneTrackLayout;
  nextPreference: PaneLayoutPreference;
  effectiveWidthChanged: boolean;
}

export const resizePanePreference = (
  pane: ResizablePane,
  requestedEffectiveWidth: number,
  inputPreference: PaneLayoutPreference,
  containerWidth: number,
): PaneLayoutPreference => {
  const preference = normalizePaneLayoutPreference(inputPreference);
  const { minWidth, maxWidth } = getPaneBounds(pane, preference, containerWidth);
  const currentPreferredWidth = preference[pane].preferredWidth;
  const nextPreferredWidth = clamp(
    isFiniteNumber(requestedEffectiveWidth)
      ? requestedEffectiveWidth
      : currentPreferredWidth,
    minWidth,
    maxWidth,
  );

  return {
    ...preference,
    [pane]: {
      ...preference[pane],
      preferredWidth: nextPreferredWidth,
    },
  };
};

/**
 * Resolves a user resize against the current workspace without allowing a
 * temporarily constrained effective width to replace an unchanged preference.
 */
export const resolvePaneResizeIntent = ({
  preference: inputPreference,
  pane,
  requestedEffectiveWidth,
  containerWidth,
}: PaneResizeIntentInput): PaneResizeIntent => {
  const preference = normalizePaneLayoutPreference(inputPreference);
  const startingTracks = getPaneTrackLayout(preference, containerWidth);
  const candidatePreference = resizePanePreference(
    pane,
    requestedEffectiveWidth,
    preference,
    containerWidth,
  );
  const candidateTracks = getPaneTrackLayout(candidatePreference, containerWidth);

  if (candidateTracks[pane].effectiveWidth === startingTracks[pane].effectiveWidth) {
    return {
      tracks: startingTracks,
      nextPreference: preference,
      effectiveWidthChanged: false,
    };
  }

  const nextPreference = {
    ...candidatePreference,
    [pane]: {
      ...candidatePreference[pane],
      preferredWidth: candidateTracks[pane].effectiveWidth,
    },
  };
  const tracks = getPaneTrackLayout(nextPreference, containerWidth);

  if (tracks[pane].effectiveWidth === startingTracks[pane].effectiveWidth) {
    return {
      tracks: startingTracks,
      nextPreference: preference,
      effectiveWidthChanged: false,
    };
  }

  return {
    tracks,
    nextPreference,
    effectiveWidthChanged: true,
  };
};

export const isCollapseArmed = (
  pane: ResizablePane,
  requestedEffectiveWidth: number,
): boolean => {
  const { minWidth } = getPaneConfig(pane);
  return isFiniteNumber(requestedEffectiveWidth)
    && requestedEffectiveWidth <= minWidth - PANE_LAYOUT.collapseThreshold;
};

export const shouldCollapseAfterDrag = (
  endReason: DragEndReason,
  collapseArmed: boolean,
): boolean => endReason === 'pointerup' && collapseArmed;

export const collapsePanePreference = (
  inputPreference: PaneLayoutPreference,
  pane: ResizablePane,
): PaneLayoutPreference => {
  const preference = normalizePaneLayoutPreference(inputPreference);

  return {
    ...preference,
    [pane]: {
      ...preference[pane],
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
