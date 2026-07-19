import {
  PANE_LAYOUT,
  clamp,
  getPaneConfig,
  isFiniteNumber,
  normalizePaneLayoutPreference,
  type DragEndReason,
  type PaneLayoutPreference,
  type ResizablePane,
} from './paneLayoutModel';
import { getPaneBounds } from './paneLayoutGeometry';

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
