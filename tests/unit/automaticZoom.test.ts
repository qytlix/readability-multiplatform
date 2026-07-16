import { describe, expect, it } from 'vitest';
import {
  MAXIMIZED_WINDOW_ZOOM_FACTOR,
  getAutomaticZoomFactor,
} from '../../src/main/window/automaticZoom';

describe('automatic window zoom', () => {
  it.each([
    [false, 1],
    [true, MAXIMIZED_WINDOW_ZOOM_FACTOR],
  ])('uses a %s window state to select a %f zoom factor', (isExpanded, zoomFactor) => {
    expect(getAutomaticZoomFactor(isExpanded)).toBe(zoomFactor);
  });
});
