import { describe, expect, it } from 'vitest';
import {
  getReadingBookTurnDirection,
  getReadingBookTurnDuration,
  getReadingBookTurnVariant,
} from '../../../src/renderer/features/feeds/readingProgressBookMotion';

describe('reading progress book motion', () => {
  it('turns left while scrolling down and right while scrolling up', () => {
    expect(getReadingBookTurnDirection(32)).toBe('left');
    expect(getReadingBookTurnDirection(-32)).toBe('right');
    expect(getReadingBookTurnDirection(0)).toBeNull();
  });

  it('turns faster as scroll speed increases', () => {
    const slowTurn = getReadingBookTurnDuration(12, 120);
    const mediumTurn = getReadingBookTurnDuration(48, 80);
    const fastTurn = getReadingBookTurnDuration(160, 24);

    expect(slowTurn).toBeGreaterThan(mediumTurn);
    expect(mediumTurn).toBeGreaterThan(fastTurn);
  });

  it('keeps page turns within legible animation bounds', () => {
    expect(getReadingBookTurnDuration(0, 100)).toBe(620);
    expect(getReadingBookTurnDuration(10_000, 1)).toBe(170);
  });

  it('uses one complete page for a short scroll and the folded stack after it grows', () => {
    expect(getReadingBookTurnVariant(24)).toBe('single');
    expect(getReadingBookTurnVariant(-60)).toBe('single');
    expect(getReadingBookTurnVariant(99)).toBe('single');
    expect(getReadingBookTurnVariant(100)).toBe('stack');
  });
});
