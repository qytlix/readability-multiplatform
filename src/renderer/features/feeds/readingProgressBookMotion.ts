export type ReadingBookTurnDirection = 'left' | 'right';
export type ReadingBookTurnVariant = 'single' | 'stack';

export interface ReadingBookTurnMotion {
  id: number;
  direction: ReadingBookTurnDirection;
  durationMs: number;
  variant: ReadingBookTurnVariant;
}

const MINIMUM_TURN_DURATION_MS = 170;
const MAXIMUM_TURN_DURATION_MS = 620;
const FULL_SPEED_PIXELS_PER_MILLISECOND = 2.4;
export const SINGLE_PAGE_SCROLL_DISTANCE_PX = 100;

export const getReadingBookTurnDuration = (
  scrollDelta: number,
  elapsedMs: number,
): number => {
  const normalizedElapsedMs = Math.max(8, elapsedMs);
  const scrollSpeed = Math.abs(scrollDelta) / normalizedElapsedMs;
  const speedRatio = Math.min(
    1,
    scrollSpeed / FULL_SPEED_PIXELS_PER_MILLISECOND,
  );

  return Math.round(
    MAXIMUM_TURN_DURATION_MS
      - (
        MAXIMUM_TURN_DURATION_MS
        - MINIMUM_TURN_DURATION_MS
      ) * speedRatio,
  );
};

export const getReadingBookTurnDirection = (
  scrollDelta: number,
): ReadingBookTurnDirection | null => {
  if (scrollDelta > 0) return 'left';
  if (scrollDelta < 0) return 'right';
  return null;
};

export const getReadingBookTurnVariant = (
  scrollDistance: number,
): ReadingBookTurnVariant => (
  Math.abs(scrollDistance) < SINGLE_PAGE_SCROLL_DISTANCE_PX
    ? 'single'
    : 'stack'
);
