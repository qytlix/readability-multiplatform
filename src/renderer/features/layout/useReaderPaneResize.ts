import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import {
  PANE_LAYOUT,
  clamp,
} from './paneLayoutModel';
import {
  loadPaneLayoutPreference,
  savePaneLayoutPreference,
} from './paneLayoutStorage';

interface ReaderPaneResizeOptions {
  storyListRef: RefObject<HTMLElement | null>;
  sidebarOpen: boolean;
  readingFocus: boolean;
}

interface ReaderPaneBounds {
  minimum: number;
  maximum: number;
}

interface ActiveDrag {
  pointerId: number;
  startClientX: number;
  startWidth: number;
  divider: HTMLDivElement;
}

export interface ReaderPaneResizeControls {
  workspaceRef: RefObject<HTMLDivElement | null>;
  effectiveWidth: number;
  minimum: number;
  maximum: number;
  isDragging: boolean;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

const DEFAULT_BOUNDS: ReaderPaneBounds = {
  minimum: PANE_LAYOUT.entry.minWidth,
  maximum: PANE_LAYOUT.entry.maxWidth,
};

export const getReaderPaneBounds = (
  workspaceWidth: number,
  storyListOffset: number,
): ReaderPaneBounds => {
  if (!Number.isFinite(workspaceWidth) || workspaceWidth <= 0) {
    return DEFAULT_BOUNDS;
  }

  const safeOffset = Number.isFinite(storyListOffset)
    ? Math.max(0, storyListOffset)
    : 0;
  const availableListWidth = Math.floor(
    workspaceWidth
      - safeOffset
      - PANE_LAYOUT.dividerWidth
      - PANE_LAYOUT.readerMinWidth,
  );

  return {
    minimum: PANE_LAYOUT.entry.minWidth,
    maximum: Math.max(
      PANE_LAYOUT.entry.minWidth,
      Math.min(PANE_LAYOUT.entry.maxWidth, availableListWidth),
    ),
  };
};

export const useReaderPaneResize = ({
  storyListRef,
  sidebarOpen,
  readingFocus,
}: ReaderPaneResizeOptions): ReaderPaneResizeControls => {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const initialWidthRef = useRef<number | null>(null);
  if (initialWidthRef.current === null) {
    initialWidthRef.current = loadPaneLayoutPreference().entry.preferredWidth;
  }

  const [preferredWidth, setPreferredWidth] = useState(initialWidthRef.current);
  const preferredWidthRef = useRef(preferredWidth);
  const [bounds, setBounds] = useState<ReaderPaneBounds>(DEFAULT_BOUNDS);
  const boundsRef = useRef(bounds);
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const pendingWidthRef = useRef<number | null>(null);
  const finishDragRef = useRef<() => void>(() => undefined);
  const [isDragging, setIsDragging] = useState(false);
  const effectiveWidth = clamp(preferredWidth, bounds.minimum, bounds.maximum);
  const renderedWidthRef = useRef(effectiveWidth);

  const updateBounds = useCallback((nextBounds: ReaderPaneBounds) => {
    boundsRef.current = nextBounds;
    setBounds((currentBounds) => (
      currentBounds.minimum === nextBounds.minimum
        && currentBounds.maximum === nextBounds.maximum
        ? currentBounds
        : nextBounds
    ));
  }, []);

  const measureBounds = useCallback(() => {
    const workspace = workspaceRef.current;
    const storyList = storyListRef.current;
    if (!workspace || !storyList) return;

    const workspaceRect = workspace.getBoundingClientRect();
    const storyListRect = storyList.getBoundingClientRect();
    updateBounds(getReaderPaneBounds(
      workspaceRect.width,
      storyListRect.left - workspaceRect.left,
    ));
  }, [storyListRef, updateBounds]);

  useLayoutEffect(() => {
    measureBounds();
  }, [measureBounds, readingFocus, sidebarOpen]);

  useLayoutEffect(() => {
    if (activeDragRef.current) return;

    renderedWidthRef.current = effectiveWidth;
    workspaceRef.current?.style.setProperty(
      '--reader-list-width',
      `${effectiveWidth}px`,
    );
  }, [effectiveWidth]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return undefined;

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(measureBounds);
    observer?.observe(workspace);
    window.addEventListener('resize', measureBounds);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measureBounds);
    };
  }, [measureBounds]);

  const getClampedWidth = useCallback((requestedWidth: number): number => clamp(
    Math.round(requestedWidth),
    boundsRef.current.minimum,
    boundsRef.current.maximum,
  ), []);

  const commitWidth = useCallback((requestedWidth: number): boolean => {
    const nextWidth = getClampedWidth(requestedWidth);
    if (nextWidth === renderedWidthRef.current) return false;

    renderedWidthRef.current = nextWidth;
    preferredWidthRef.current = nextWidth;
    setPreferredWidth(nextWidth);
    return true;
  }, [getClampedWidth]);

  const previewWidth = useCallback((requestedWidth: number): boolean => {
    const nextWidth = getClampedWidth(requestedWidth);
    if (nextWidth === renderedWidthRef.current) return false;

    renderedWidthRef.current = nextWidth;
    pendingWidthRef.current = nextWidth;
    workspaceRef.current?.style.setProperty(
      '--reader-list-width',
      `${nextWidth}px`,
    );
    activeDragRef.current?.divider.setAttribute(
      'aria-valuenow',
      String(nextWidth),
    );
    return true;
  }, [getClampedWidth]);

  const readEffectiveWidth = useCallback((): number => clamp(
    preferredWidthRef.current,
    boundsRef.current.minimum,
    boundsRef.current.maximum,
  ), []);

  const persistPreferredWidth = useCallback(() => {
    const preference = loadPaneLayoutPreference();
    const nextWidth = preferredWidthRef.current;
    if (
      preference.entry.preferredWidth === nextWidth
      && !preference.entry.collapsed
    ) {
      return;
    }

    savePaneLayoutPreference({
      ...preference,
      entry: {
        preferredWidth: nextWidth,
        collapsed: false,
      },
    });
  }, []);

  const handleWindowBlur = useCallback(() => {
    finishDragRef.current();
  }, []);

  const finishDrag = useCallback(() => {
    const activeDrag = activeDragRef.current;
    if (!activeDrag) return;

    activeDragRef.current = null;
    const pendingWidth = pendingWidthRef.current;
    pendingWidthRef.current = null;
    window.removeEventListener('blur', handleWindowBlur);
    document.body.classList.remove('workspace-is-resizing');
    setIsDragging(false);

    if (
      typeof activeDrag.divider.hasPointerCapture === 'function'
      && activeDrag.divider.hasPointerCapture(activeDrag.pointerId)
    ) {
      activeDrag.divider.releasePointerCapture(activeDrag.pointerId);
    }

    if (pendingWidth !== null) {
      preferredWidthRef.current = pendingWidth;
      setPreferredWidth(pendingWidth);
      persistPreferredWidth();
    }
  }, [handleWindowBlur, persistPreferredWidth]);

  finishDragRef.current = finishDrag;

  useEffect(() => () => {
    activeDragRef.current = null;
    pendingWidthRef.current = null;
    window.removeEventListener('blur', handleWindowBlur);
    document.body.classList.remove('workspace-is-resizing');
  }, [handleWindowBlur]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || activeDragRef.current) return;

    event.preventDefault();
    const divider = event.currentTarget;
    divider.setPointerCapture(event.pointerId);
    activeDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWidth: readEffectiveWidth(),
      divider,
    };
    renderedWidthRef.current = readEffectiveWidth();
    pendingWidthRef.current = null;
    document.body.classList.add('workspace-is-resizing');
    window.addEventListener('blur', handleWindowBlur);
    setIsDragging(true);
  }, [handleWindowBlur, readEffectiveWidth]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const activeDrag = activeDragRef.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;

    event.preventDefault();
    previewWidth(
      activeDrag.startWidth + event.clientX - activeDrag.startClientX,
    );
  }, [previewWidth]);

  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (activeDragRef.current?.pointerId === event.pointerId) finishDrag();
  }, [finishDrag]);

  const onPointerCancel = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (activeDragRef.current?.pointerId === event.pointerId) finishDrag();
  }, [finishDrag]);

  const onLostPointerCapture = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (activeDragRef.current?.pointerId === event.pointerId) finishDrag();
  }, [finishDrag]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    event.preventDefault();
    const step = event.shiftKey
      ? PANE_LAYOUT.keyboardLargeStep
      : PANE_LAYOUT.keyboardStep;
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    if (commitWidth(readEffectiveWidth() + direction * step)) {
      persistPreferredWidth();
    }
  }, [commitWidth, persistPreferredWidth, readEffectiveWidth]);

  return {
    workspaceRef,
    effectiveWidth,
    minimum: bounds.minimum,
    maximum: bounds.maximum,
    isDragging,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    onKeyDown,
  };
};
