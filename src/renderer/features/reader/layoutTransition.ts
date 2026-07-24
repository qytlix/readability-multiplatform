export type LayoutRect = Pick<DOMRect, 'left' | 'top' | 'width'>;

const MINIMUM_LAYOUT_DELTA = 0.5;

export const createHorizontalFlipKeyframes = (
  previous: LayoutRect,
  current: LayoutRect,
): Keyframe[] | null => {
  if (previous.width <= 0 || current.width <= 0) return null;

  const translateX = previous.left - current.left;
  const translateY = previous.top - current.top;
  const scaleX = previous.width / current.width;
  const moved = Math.abs(translateX) >= MINIMUM_LAYOUT_DELTA
    || Math.abs(translateY) >= MINIMUM_LAYOUT_DELTA;
  const resized = Math.abs(scaleX - 1) >= 0.001;

  if (!moved && !resized) return null;

  return [
    {
      transform: `translate3d(${translateX}px, ${translateY}px, 0) scaleX(${scaleX})`,
      transformOrigin: 'top left',
    },
    {
      transform: 'translate3d(0, 0, 0) scaleX(1)',
      transformOrigin: 'top left',
    },
  ];
};
