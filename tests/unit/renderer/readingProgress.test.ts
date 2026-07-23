import { describe, expect, it } from 'vitest';
import {
  calculateReadingProgress,
  getReadingProgressPercentage,
  getScrollTopForReadingProgress,
} from '../../../src/renderer/features/feeds/readingProgress';

describe('reading progress', () => {
  it('calculates progress from the scrollable distance', () => {
    expect(calculateReadingProgress({
      scrollTop: 500,
      scrollHeight: 1500,
      clientHeight: 500,
    })).toBe(0.5);
  });

  it('counts the article as complete at the bottom tolerance', () => {
    expect(calculateReadingProgress({
      scrollTop: 980,
      scrollHeight: 1500,
      clientHeight: 500,
    })).toBe(1);
  });

  it('counts a fully visible short article as complete', () => {
    expect(calculateReadingProgress({
      scrollTop: 0,
      scrollHeight: 480,
      clientHeight: 500,
    })).toBe(1);
  });

  it('restores the saved relative position for a changed layout', () => {
    expect(getScrollTopForReadingProgress(0.4, 2500, 500)).toBe(800);
  });

  it('clamps invalid restoration values at the viewport boundaries', () => {
    expect(getScrollTopForReadingProgress(-1, 1500, 500)).toBe(0);
    expect(getScrollTopForReadingProgress(2, 1500, 500)).toBe(1000);
  });

  it('formats each saved article progress as a clamped percentage', () => {
    expect(getReadingProgressPercentage(0.794)).toBe(79);
    expect(getReadingProgressPercentage(-1)).toBe(0);
    expect(getReadingProgressPercentage(2)).toBe(100);
  });
});
