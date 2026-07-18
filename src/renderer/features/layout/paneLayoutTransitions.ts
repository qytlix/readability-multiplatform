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
  requestedWidth: number,
  inputPreference: PaneLayoutPreference,
  containerWidth: number,
): PaneLayoutPreference => {
  const preference = normalizePaneLayoutPreference(inputPreference);
  const { minWidth, maxWidth } = getPaneBounds(pane, preference, containerWidth);
  const currentWidth = preference[pane].width;
  const nextWidth = clamp(
    isFiniteNumber(requestedWidth) ? requestedWidth : currentWidth,
    minWidth,
    maxWidth,
  );

  return {
    ...preference,
    [pane]: {
      ...preference[pane],
      width: nextWidth,
    },
  };
};

export const isCollapseArmed = (
  pane: ResizablePane,
  requestedWidth: number,
): boolean => {
  const { minWidth } = getPaneConfig(pane);
  return isFiniteNumber(requestedWidth)
    && requestedWidth <= minWidth - PANE_LAYOUT.collapseThreshold;
};

export const shouldCollapseAfterDrag = (
  endReason: DragEndReason,
  collapseArmed: boolean,
): boolean => endReason === 'pointerup' && collapseArmed;

export const collapsePanePreference = (
  inputPreference: PaneLayoutPreference,
  pane: ResizablePane,
  lastExpandedWidth: number,
): PaneLayoutPreference => {
  const preference = normalizePaneLayoutPreference(inputPreference);
  const config = getPaneConfig(pane);
  const savedWidth = clamp(
    isFiniteNumber(lastExpandedWidth) ? lastExpandedWidth : preference[pane].width,
    config.minWidth,
    config.maxWidth,
  );

  return {
    ...preference,
    [pane]: {
      width: savedWidth,
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
