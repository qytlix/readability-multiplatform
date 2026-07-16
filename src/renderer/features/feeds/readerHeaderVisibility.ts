export type FloatingReaderHeaderAction = 'show' | 'hide' | 'keep';

interface ReaderHeaderScrollState {
  currentScrollTop: number;
  previousScrollTop: number;
  headerHeight: number;
  isHeaderHovered: boolean;
}

interface ReaderHeaderWindowTopState {
  pointerY: number;
  revealZoneHeight: number;
  currentScrollTop: number;
  headerHeight: number;
}

/**
 * The in-flow article header remains the source of truth. A floating copy is
 * only revealed after that header has scrolled out of view and the reader
 * reverses upward.
 */
export const getFloatingReaderHeaderAction = ({
  currentScrollTop,
  previousScrollTop,
  headerHeight,
  isHeaderHovered,
}: ReaderHeaderScrollState): FloatingReaderHeaderAction => {
  if (currentScrollTop <= headerHeight) {
    return 'hide';
  }

  if (currentScrollTop < previousScrollTop) {
    return 'show';
  }

  if (currentScrollTop > previousScrollTop && !isHeaderHovered) {
    return 'hide';
  }

  return 'keep';
};

export const shouldRevealFloatingReaderHeaderAtWindowTop = ({
  pointerY,
  revealZoneHeight,
  currentScrollTop,
  headerHeight,
}: ReaderHeaderWindowTopState): boolean => pointerY <= revealZoneHeight
  && currentScrollTop > headerHeight;
