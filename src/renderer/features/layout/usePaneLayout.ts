import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import {
  PANE_LAYOUT,
  constrainPaneWidths,
  getMinimumWorkspaceWidth,
  loadPaneWidths,
  resizePane,
  savePaneWidths,
  type PaneWidths,
  type ResizablePane,
} from './paneLayout';

interface ActiveDrag {
  pane: ResizablePane;
  pointerId: number;
  startClientX: number;
  startWidth: number;
  divider: HTMLDivElement;
}

const arePaneWidthsEqual = (left: PaneWidths, right: PaneWidths): boolean =>
  left.feedWidth === right.feedWidth && left.entryWidth === right.entryWidth;

export interface PaneLayoutControls {
  layoutRef: RefObject<HTMLDivElement | null>;
  widths: PaneWidths;
  containerWidth: number;
  draggingPane: ResizablePane | null;
  onDividerPointerDown: (
    pane: ResizablePane,
    event: PointerEvent<HTMLDivElement>,
  ) => void;
  onDividerPointerMove: (
    pane: ResizablePane,
    event: PointerEvent<HTMLDivElement>,
  ) => void;
  onDividerPointerUp: (
    pane: ResizablePane,
    event: PointerEvent<HTMLDivElement>,
  ) => void;
  onDividerPointerCancel: (
    pane: ResizablePane,
    event: PointerEvent<HTMLDivElement>,
  ) => void;
  onDividerLostPointerCapture: (
    pane: ResizablePane,
    event: PointerEvent<HTMLDivElement>,
  ) => void;
  onDividerKeyDown: (
    pane: ResizablePane,
    event: KeyboardEvent<HTMLDivElement>,
  ) => void;
}

export const usePaneLayout = (): PaneLayoutControls => {
  const layoutRef = useRef<HTMLDivElement>(null);
  const initialPreferredWidthsRef = useRef<PaneWidths | null>(null);
  if (initialPreferredWidthsRef.current === null) {
    initialPreferredWidthsRef.current = loadPaneWidths();
  }
  const initialPreferredWidths = initialPreferredWidthsRef.current;
  const [widths, setWidths] = useState<PaneWidths>(() => constrainPaneWidths(
    initialPreferredWidths,
    getMinimumWorkspaceWidth(),
  ));
  const preferredWidthsRef = useRef<PaneWidths>(initialPreferredWidths);
  const renderedWidthsRef = useRef<PaneWidths>(widths);
  const containerWidthRef = useRef(getMinimumWorkspaceWidth());
  const [containerWidth, setContainerWidth] = useState(getMinimumWorkspaceWidth());
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const pendingWidthsRef = useRef<PaneWidths | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const finishDragRef = useRef<(shouldCommit: boolean) => void>(() => undefined);
  const [draggingPane, setDraggingPane] = useState<ResizablePane | null>(null);

  const handleWindowBlur = useCallback(() => {
    finishDragRef.current(true);
  }, []);

  const getContainerWidth = useCallback((): number => {
    const measuredWidth = layoutRef.current?.getBoundingClientRect().width;
    if (measuredWidth && Number.isFinite(measuredWidth)) {
      containerWidthRef.current = measuredWidth;
    }

    return containerWidthRef.current;
  }, []);

  const writeWidths = useCallback((nextWidths: PaneWidths) => {
    renderedWidthsRef.current = nextWidths;
    const layoutElement = layoutRef.current;
    if (!layoutElement) return;

    layoutElement.style.setProperty('--workspace-feed-width', `${nextWidths.feedWidth}px`);
    layoutElement.style.setProperty('--workspace-entry-width', `${nextWidths.entryWidth}px`);
  }, []);

  const updateRenderedWidths = useCallback((nextWidths: PaneWidths) => {
    setWidths((currentWidths) => (
      arePaneWidthsEqual(currentWidths, nextWidths) ? currentWidths : nextWidths
    ));
  }, []);

  const syncWidthsToContainer = useCallback(() => {
    const measuredContainerWidth = getContainerWidth();
    const nextWidths = constrainPaneWidths(
      preferredWidthsRef.current,
      measuredContainerWidth,
    );
    writeWidths(nextWidths);
    updateRenderedWidths(nextWidths);
    setContainerWidth((currentWidth) => (
      currentWidth === measuredContainerWidth ? currentWidth : measuredContainerWidth
    ));
  }, [getContainerWidth, updateRenderedWidths, writeWidths]);

  const flushPendingWidths = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const pendingWidths = pendingWidthsRef.current;
    pendingWidthsRef.current = null;
    if (pendingWidths) {
      writeWidths(pendingWidths);
    }
  }, [writeWidths]);

  const queueWidthWrite = useCallback((nextWidths: PaneWidths) => {
    pendingWidthsRef.current = nextWidths;
    if (animationFrameRef.current !== null) return;

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const pendingWidths = pendingWidthsRef.current;
      pendingWidthsRef.current = null;
      if (pendingWidths) {
        writeWidths(pendingWidths);
      }
    });
  }, [writeWidths]);

  const commitWidths = useCallback((nextWidths: PaneWidths) => {
    const constrainedWidths = constrainPaneWidths(nextWidths, getContainerWidth());
    preferredWidthsRef.current = constrainedWidths;
    writeWidths(constrainedWidths);
    updateRenderedWidths(constrainedWidths);
    savePaneWidths(constrainedWidths);
  }, [getContainerWidth, updateRenderedWidths, writeWidths]);

  const finishDrag = useCallback((shouldCommit: boolean) => {
    const activeDrag = activeDragRef.current;
    if (!activeDrag) return;

    flushPendingWidths();
    activeDragRef.current = null;
    window.removeEventListener('blur', handleWindowBlur);
    document.body.classList.remove('workspace-is-resizing');
    setDraggingPane(null);

    if (activeDrag.divider.hasPointerCapture(activeDrag.pointerId)) {
      activeDrag.divider.releasePointerCapture(activeDrag.pointerId);
    }

    if (shouldCommit) {
      commitWidths(renderedWidthsRef.current);
    }
  }, [commitWidths, flushPendingWidths, handleWindowBlur]);

  finishDragRef.current = finishDrag;

  useEffect(() => {
    const layoutElement = layoutRef.current;
    if (!layoutElement) return undefined;

    syncWidthsToContainer();
    const observer = new ResizeObserver(syncWidthsToContainer);
    observer.observe(layoutElement);

    return () => {
      observer.disconnect();
    };
  }, [syncWidthsToContainer]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
    window.removeEventListener('blur', handleWindowBlur);
    document.body.classList.remove('workspace-is-resizing');
  }, [handleWindowBlur]);

  const onDividerPointerDown = useCallback((
    pane: ResizablePane,
    event: PointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0 || activeDragRef.current) return;

    const containerWidth = getContainerWidth();
    if (containerWidth <= 0) return;

    event.preventDefault();
    const divider = event.currentTarget;
    divider.setPointerCapture(event.pointerId);
    activeDragRef.current = {
      pane,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWidth: pane === 'feed'
        ? renderedWidthsRef.current.feedWidth
        : renderedWidthsRef.current.entryWidth,
      divider,
    };
    document.body.classList.add('workspace-is-resizing');
    window.addEventListener('blur', handleWindowBlur);
    setDraggingPane(pane);
  }, [getContainerWidth, handleWindowBlur]);

  const onDividerPointerMove = useCallback((
    pane: ResizablePane,
    event: PointerEvent<HTMLDivElement>,
  ) => {
    const activeDrag = activeDragRef.current;
    if (!activeDrag || activeDrag.pane !== pane || activeDrag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const requestedWidth = activeDrag.startWidth + event.clientX - activeDrag.startClientX;
    const nextWidths = resizePane(
      pane,
      requestedWidth,
      renderedWidthsRef.current,
      getContainerWidth(),
    );
    queueWidthWrite(nextWidths);
  }, [getContainerWidth, queueWidthWrite]);

  const onDividerPointerUp = useCallback((
    pane: ResizablePane,
    event: PointerEvent<HTMLDivElement>,
  ) => {
    const activeDrag = activeDragRef.current;
    if (activeDrag?.pane === pane && activeDrag.pointerId === event.pointerId) {
      finishDrag(true);
    }
  }, [finishDrag]);

  const onDividerPointerCancel = useCallback((
    pane: ResizablePane,
    event: PointerEvent<HTMLDivElement>,
  ) => {
    const activeDrag = activeDragRef.current;
    if (activeDrag?.pane === pane && activeDrag.pointerId === event.pointerId) {
      finishDrag(true);
    }
  }, [finishDrag]);

  const onDividerLostPointerCapture = useCallback((
    pane: ResizablePane,
    event: PointerEvent<HTMLDivElement>,
  ) => {
    const activeDrag = activeDragRef.current;
    if (activeDrag?.pane === pane && activeDrag.pointerId === event.pointerId) {
      finishDrag(true);
    }
  }, [finishDrag]);

  const onDividerKeyDown = useCallback((
    pane: ResizablePane,
    event: KeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    event.preventDefault();
    const step = event.shiftKey
      ? PANE_LAYOUT.keyboardLargeStep
      : PANE_LAYOUT.keyboardStep;
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    const currentWidth = pane === 'feed'
      ? renderedWidthsRef.current.feedWidth
      : renderedWidthsRef.current.entryWidth;
    const nextWidths = resizePane(
      pane,
      currentWidth + direction * step,
      renderedWidthsRef.current,
      getContainerWidth(),
    );
    commitWidths(nextWidths);
  }, [commitWidths, getContainerWidth]);

  return {
    layoutRef,
    widths,
    containerWidth,
    draggingPane,
    onDividerPointerDown,
    onDividerPointerMove,
    onDividerPointerUp,
    onDividerPointerCancel,
    onDividerLostPointerCapture,
    onDividerKeyDown,
  };
};
