const clampProgress = (value: number): number => Math.min(1, Math.max(0, value));

export const getReadingProgressPercentage = (readingProgress: number): number =>
  Math.round(clampProgress(readingProgress) * 100);

export interface ReadingViewport {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export const calculateReadingProgress = ({
  scrollTop,
  scrollHeight,
  clientHeight,
}: ReadingViewport, bottomTolerance = 24): number => {
  const maximumScrollTop = Math.max(0, scrollHeight - clientHeight);
  if (maximumScrollTop <= bottomTolerance) return 1;

  const normalizedScrollTop = Math.min(maximumScrollTop, Math.max(0, scrollTop));
  if (maximumScrollTop - normalizedScrollTop <= bottomTolerance) return 1;
  return clampProgress(normalizedScrollTop / maximumScrollTop);
};

export const getScrollTopForReadingProgress = (
  readingProgress: number,
  scrollHeight: number,
  clientHeight: number,
): number => {
  const maximumScrollTop = Math.max(0, scrollHeight - clientHeight);
  return clampProgress(readingProgress) * maximumScrollTop;
};
