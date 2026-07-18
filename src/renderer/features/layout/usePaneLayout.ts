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
  collapsePanePreference,
  getMinimumWorkspaceWidth,
  getPaneTrackLayout,
  isCollapseArmed,
  resizePanePreference,
  restorePanePreference,
  shouldCollapseAfterDrag,
  type DragEndReason,
  type PaneLayoutPreference,
  type PaneTrackLayout,
  type ResizablePane,
} from './paneLayout';
import { writeWorkspaceCssVariables } from './paneLayoutCssVariables';
import {
  loadPaneLayoutPreference,
  savePaneLayoutPreference,
} from './paneLayoutStorage';

interface ActiveDrag {
  pane: ResizablePane;
  pointerId: number;
  startClientX: number;
  startWidth: number;
  divider: HTMLDivElement;
  collapseArmed: boolean;
}

const areTrackLayoutsEqual = (
  left: PaneTrackLayout,
  right: PaneTrackLayout,
): boolean => (
  left.feed.collapsed === right.feed.collapsed
  && left.feed.expandedWidth === right.feed.expandedWidth
  && left.feed.trackWidth === right.feed.trackWidth
  && left.feed.dividerWidth === right.feed.dividerWidth
  && left.entry.collapsed === right.entry.collapsed
  && left.entry.expandedWidth === right.entry.expandedWidth
  && left.entry.trackWidth === right.entry.trackWidth
  && left.entry.dividerWidth === right.entry.dividerWidth
);

export interface PaneLayoutControls {
  layoutRef: RefObject<HTMLDivElement | null>;
  preference: PaneLayoutPreference;
  tracks: PaneTrackLayout;
  containerWidth: number;
  draggingPane: ResizablePane | null;
  collapseArmedPane: ResizablePane | null;
  collapsePane: (pane: ResizablePane) => void;
  restorePane: (pane: ResizablePane) => void;
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
  const initialPreferenceRef = useRef<PaneLayoutPreference | null>(null);
  if (initialPreferenceRef.current === null) {
    initialPreferenceRef.current = loadPaneLayoutPreference();
  }
  const initialPreference = initialPreferenceRef.current;
  const [preference, setPreference] = useState<PaneLayoutPreference>(initialPreference);
  const preferenceRef = useRef<PaneLayoutPreference>(initialPreference);
  const [tracks, setTracks] = useState<PaneTrackLayout>(() => getPaneTrackLayout(
    initialPreference,
    getMinimumWorkspaceWidth(),
  ));
  const renderedTracksRef = useRef<PaneTrackLayout>(tracks);
  const containerWidthRef = useRef(getMinimumWorkspaceWidth());
  const [containerWidth, setContainerWidth] = useState(getMinimumWorkspaceWidth());
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const pendingPreferenceRef = useRef<PaneLayoutPreference | null>(null);
  const pendingTracksRef = useRef<PaneTrackLayout | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const finishDragRef = useRef<(endReason: DragEndReason) => void>(() => undefined);
  const [draggingPane, setDraggingPane] = useState<ResizablePane | null>(null);
  const [collapseArmedPane, setCollapseArmedPane] = useState<ResizablePane | null>(null);

  const handleWindowBlur = useCallback(() => {
    finishDragRef.current('windowblur');
  }, []);

  const getContainerWidth = useCallback((): number => {
    const measuredWidth = layoutRef.current?.getBoundingClientRect().width;
    if (measuredWidth && Number.isFinite(measuredWidth)) {
      containerWidthRef.current = measuredWidth;
    }

    return containerWidthRef.current;
  }, []);

  const writeTracks = useCallback((nextTracks: PaneTrackLayout) => {
    renderedTracksRef.current = nextTracks;
    const layoutElement = layoutRef.current;
    if (!layoutElement) return;

    writeWorkspaceCssVariables(layoutElement, nextTracks);
  }, []);

  const updateRenderedTracks = useCallback((nextTracks: PaneTrackLayout) => {
    setTracks((currentTracks) => (
      areTrackLayoutsEqual(currentTracks, nextTracks) ? currentTracks : nextTracks
    ));
  }, []);

  const syncTracksToContainer = useCallback(() => {
    const measuredContainerWidth = getContainerWidth();
    const nextTracks = getPaneTrackLayout(
      preferenceRef.current,
      measuredContainerWidth,
    );
    writeTracks(nextTracks);
    updateRenderedTracks(nextTracks);
    setContainerWidth((currentWidth) => (
      currentWidth === measuredContainerWidth ? currentWidth : measuredContainerWidth
    ));
  }, [getContainerWidth, updateRenderedTracks, writeTracks]);

  const flushPendingTracks = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const pendingTracks = pendingTracksRef.current;
    pendingTracksRef.current = null;
    if (pendingTracks) {
      writeTracks(pendingTracks);
    }
  }, [writeTracks]);

  const queueTrackWrite = useCallback((nextTracks: PaneTrackLayout) => {
    pendingTracksRef.current = nextTracks;
    if (animationFrameRef.current !== null) return;

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const pendingTracks = pendingTracksRef.current;
      pendingTracksRef.current = null;
      if (pendingTracks) {
        writeTracks(pendingTracks);
      }
    });
  }, [writeTracks]);

  const commitPreference = useCallback((nextPreference: PaneLayoutPreference) => {
    preferenceRef.current = nextPreference;
    setPreference(nextPreference);
    const nextTracks = getPaneTrackLayout(nextPreference, getContainerWidth());
    writeTracks(nextTracks);
    updateRenderedTracks(nextTracks);
    savePaneLayoutPreference(nextPreference);
  }, [getContainerWidth, updateRenderedTracks, writeTracks]);

  const finishDrag = useCallback((endReason: DragEndReason) => {
    const activeDrag = activeDragRef.current;
    if (!activeDrag) return;

    flushPendingTracks();
    activeDragRef.current = null;
    const pendingPreference = pendingPreferenceRef.current;
    pendingPreferenceRef.current = null;
    window.removeEventListener('blur', handleWindowBlur);
    document.body.classList.remove('workspace-is-resizing');
    setDraggingPane(null);
    setCollapseArmedPane(null);

    if (activeDrag.divider.hasPointerCapture(activeDrag.pointerId)) {
      activeDrag.divider.releasePointerCapture(activeDrag.pointerId);
    }

    if (shouldCollapseAfterDrag(endReason, activeDrag.collapseArmed)) {
      commitPreference(
        collapsePanePreference(
          preferenceRef.current,
          activeDrag.pane,
          activeDrag.startWidth,
        ),
      );
      return;
    }

    if (pendingPreference) {
      commitPreference(pendingPreference);
    }
  }, [commitPreference, flushPendingTracks, handleWindowBlur]);

  finishDragRef.current = finishDrag;

  useEffect(() => {
    const layoutElement = layoutRef.current;
    if (!layoutElement) return undefined;

    syncTracksToContainer();
    const observer = new ResizeObserver(syncTracksToContainer);
    observer.observe(layoutElement);

    return () => {
      observer.disconnect();
    };
  }, [syncTracksToContainer]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
    activeDragRef.current = null;
    window.removeEventListener('blur', handleWindowBlur);
    document.body.classList.remove('workspace-is-resizing');
  }, [handleWindowBlur]);

  const collapsePane = useCallback((pane: ResizablePane) => {
    if (preferenceRef.current[pane].collapsed) return;

    commitPreference(
      collapsePanePreference(
        preferenceRef.current,
        pane,
        renderedTracksRef.current[pane].expandedWidth,
      ),
    );
  }, [commitPreference]);

  const restorePane = useCallback((pane: ResizablePane) => {
    if (!preferenceRef.current[pane].collapsed) return;

    commitPreference(restorePanePreference(preferenceRef.current, pane));
  }, [commitPreference]);

  const onDividerPointerDown = useCallback((
    pane: ResizablePane,
    event: PointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0 || activeDragRef.current) return;

    const containerWidthAtStart = getContainerWidth();
    if (containerWidthAtStart <= 0) return;

    event.preventDefault();
    const divider = event.currentTarget;
    divider.setPointerCapture(event.pointerId);
    activeDragRef.current = {
      pane,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWidth: renderedTracksRef.current[pane].expandedWidth,
      divider,
      collapseArmed: false,
    };
    pendingPreferenceRef.current = null;
    document.body.classList.add('workspace-is-resizing');
    window.addEventListener('blur', handleWindowBlur);
    setDraggingPane(pane);
    setCollapseArmedPane(null);
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
    const nextCollapseArmed = isCollapseArmed(pane, requestedWidth);
    if (activeDrag.collapseArmed !== nextCollapseArmed) {
      activeDrag.collapseArmed = nextCollapseArmed;
      setCollapseArmedPane(nextCollapseArmed ? pane : null);
    }

    const currentContainerWidth = getContainerWidth();
    const nextPreference = resizePanePreference(
      pane,
      requestedWidth,
      preferenceRef.current,
      currentContainerWidth,
    );
    pendingPreferenceRef.current = nextPreference;
    queueTrackWrite(getPaneTrackLayout(nextPreference, currentContainerWidth));
  }, [getContainerWidth, queueTrackWrite]);

  const onDividerPointerUp = useCallback((
    pane: ResizablePane,
    event: PointerEvent<HTMLDivElement>,
  ) => {
    const activeDrag = activeDragRef.current;
    if (activeDrag?.pane === pane && activeDrag.pointerId === event.pointerId) {
      finishDrag('pointerup');
    }
  }, [finishDrag]);

  const onDividerPointerCancel = useCallback((
    pane: ResizablePane,
    event: PointerEvent<HTMLDivElement>,
  ) => {
    const activeDrag = activeDragRef.current;
    if (activeDrag?.pane === pane && activeDrag.pointerId === event.pointerId) {
      finishDrag('pointercancel');
    }
  }, [finishDrag]);

  const onDividerLostPointerCapture = useCallback((
    pane: ResizablePane,
    event: PointerEvent<HTMLDivElement>,
  ) => {
    const activeDrag = activeDragRef.current;
    if (activeDrag?.pane === pane && activeDrag.pointerId === event.pointerId) {
      finishDrag('lostpointercapture');
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
    const currentWidth = renderedTracksRef.current[pane].expandedWidth;
    const nextPreference = resizePanePreference(
      pane,
      currentWidth + direction * step,
      preferenceRef.current,
      getContainerWidth(),
    );
    commitPreference(nextPreference);
  }, [commitPreference, getContainerWidth]);

  return {
    layoutRef,
    preference,
    tracks,
    containerWidth,
    draggingPane,
    collapseArmedPane,
    collapsePane,
    restorePane,
    onDividerPointerDown,
    onDividerPointerMove,
    onDividerPointerUp,
    onDividerPointerCancel,
    onDividerLostPointerCapture,
    onDividerKeyDown,
  };
};
