import { describe, expect, it } from 'vitest';
import {
  getFloatingReaderHeaderAction,
  shouldRevealFloatingReaderHeaderAtWindowTop,
} from '../../../src/renderer/features/feeds/readerHeaderVisibility';

describe('reader header visibility', () => {
  const headerHeight = 120;

  it('keeps the in-flow header as the only header near the top', () => {
    expect(getFloatingReaderHeaderAction({
      currentScrollTop: 80,
      previousScrollTop: 140,
      headerHeight,
      isHeaderHovered: false,
    })).toBe('hide');
  });

  it('reveals the floating header when scrolling upward after it has left view', () => {
    expect(getFloatingReaderHeaderAction({
      currentScrollTop: 360,
      previousScrollTop: 400,
      headerHeight,
      isHeaderHovered: false,
    })).toBe('show');
  });

  it('hides the floating header when scrolling downward below it', () => {
    expect(getFloatingReaderHeaderAction({
      currentScrollTop: 400,
      previousScrollTop: 360,
      headerHeight,
      isHeaderHovered: false,
    })).toBe('hide');
  });

  it('keeps the floating header visible while it is hovered', () => {
    expect(getFloatingReaderHeaderAction({
      currentScrollTop: 400,
      previousScrollTop: 360,
      headerHeight,
      isHeaderHovered: true,
    })).toBe('keep');
  });

  it('reveals the floating header when the cursor reaches the window top', () => {
    expect(shouldRevealFloatingReaderHeaderAtWindowTop({
      pointerY: 0,
      revealZoneHeight: 60,
      currentScrollTop: 360,
      headerHeight,
    })).toBe(true);
  });

  it('does not duplicate the title while the in-flow header remains visible', () => {
    expect(shouldRevealFloatingReaderHeaderAtWindowTop({
      pointerY: 0,
      revealZoneHeight: 60,
      currentScrollTop: 80,
      headerHeight,
    })).toBe(false);
  });
});
