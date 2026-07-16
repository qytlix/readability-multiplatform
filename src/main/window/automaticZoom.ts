export const MAXIMIZED_WINDOW_ZOOM_FACTOR = 1.3;

/**
 * Matches the two-to-three browser zoom increments needed for a readable
 * maximized WSL window, without changing the normal window size.
 */
export const getAutomaticZoomFactor = (isExpanded: boolean): number =>
  isExpanded ? MAXIMIZED_WINDOW_ZOOM_FACTOR : 1;
