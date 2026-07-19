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
  resolvePaneResizeIntent,
  restorePanePreference,
  shouldCollapseAfterDrag,
  type DragEndReason,
  type PaneLayoutPreference,
  type PaneTrackLayout,
  type ResizablePane,
} from './paneLayout';
import { usePanePreferenceState } from './usePanePreferenceState';
import { usePaneTrackRenderer } from './usePaneTrackRenderer';
import {
  useWorkspaceMeasurement,
  type WorkspaceWidthChangeHandler,
} from './useWorkspaceMeasurement';

interface ActiveDrag {
  pane: ResizablePane;
  pointerId: number;
  startClientX: number;
  startEffectiveWidth: number;
  divider: HTMLDivElement;
  collapseArmed: boolean;
}

const areTrackLayoutsEqual = (
  left: PaneTrackLayout,
  right: PaneTrackLayout,
): boolean => (
  left.feed.collapsed === right.feed.collapsed
  && left.feed.effectiveWidth === right.feed.effectiveWidth
  && left.feed.trackWidth === right.feed.trackWidth
  && left.feed.dividerWidth === right.feed.dividerWidth
  && left.entry.collapsed === right.entry.collapsed
  && left.entry.effectiveWidth === right.entry.effectiveWidth
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
  const syncTracksToContainerRef = useRef<WorkspaceWidthChangeHandler>(() => undefined);
  const handleWorkspaceWidthChange = useCallback((measuredWidth: number | null) => {
    syncTracksToContainerRef.current(measuredWidth);
  }, []);
  const { layoutRef, readMeasuredWidth } = useWorkspaceMeasurement(handleWorkspaceWidthChange);
  const {
    preference,
    preferenceRef,
    commitPreferenceState,
  } = usePanePreferenceState();
  const [tracks, setTracks] = useState<PaneTrackLayout>(() => getPaneTrackLayout(
    preference,
    getMinimumWorkspaceWidth(),
  ));
  const containerWidthRef = useRef(getMinimumWorkspaceWidth());
  const [containerWidth, setContainerWidth] = useState(getMinimumWorkspaceWidth());
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const pendingPreferenceRef = useRef<PaneLayoutPreference | null>(null);
  const finishDragRef = useRef<(endReason: DragEndReason) => void>(() => undefined);
  const [draggingPane, setDraggingPane] = useState<ResizablePane | null>(null);
  const [collapseArmedPane, setCollapseArmedPane] = useState<ResizablePane | null>(null);
  const {
    renderedTracksRef,
    writeTracks,
    queueTrackWrite,
    flushPendingTracks,
    cleanupTrackRenderer,
  } = usePaneTrackRenderer(layoutRef, tracks);

  const handleWindowBlur = useCallback(() => {
    finishDragRef.current('windowblur');
  }, []);

  const getContainerWidth = useCallback((): number => {
    const measuredWidth = readMeasuredWidth();
    if (measuredWidth !== null) {
      containerWidthRef.current = measuredWidth;
    }

    return containerWidthRef.current;
  }, [readMeasuredWidth]);

  const updateRenderedTracks = useCallback((nextTracks: PaneTrackLayout) => {
    setTracks((currentTracks) => (
      areTrackLayoutsEqual(currentTracks, nextTracks) ? currentTracks : nextTracks
    ));
  }, []);

  const syncTracksToContainer = useCallback((measuredWidth: number | null) => {
    if (measuredWidth !== null) {
      containerWidthRef.current = measuredWidth;
    }

    const measuredContainerWidth = containerWidthRef.current;
    const nextTracks = getPaneTrackLayout(
      preferenceRef.current,
      measuredContainerWidth,
    );
    writeTracks(nextTracks);
    updateRenderedTracks(nextTracks);
    setContainerWidth((currentWidth) => (
      currentWidth === measuredContainerWidth ? currentWidth : measuredContainerWidth
    ));
  }, [updateRenderedTracks, writeTracks]);

  const commitPreference = useCallback((nextPreference: PaneLayoutPreference) => {
    commitPreferenceState(nextPreference, () => {
      const nextTracks = getPaneTrackLayout(nextPreference, getContainerWidth());
      writeTracks(nextTracks);
      updateRenderedTracks(nextTracks);
    });
  }, [commitPreferenceState, getContainerWidth, updateRenderedTracks, writeTracks]);

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
        ),
      );
      return;
    }

    if (pendingPreference) {
      commitPreference(pendingPreference);
    }
  }, [commitPreference, flushPendingTracks, handleWindowBlur]);

  finishDragRef.current = finishDrag;
  syncTracksToContainerRef.current = syncTracksToContainer;

  useEffect(() => () => {
    cleanupTrackRenderer();
    activeDragRef.current = null;
    window.removeEventListener('blur', handleWindowBlur);
    document.body.classList.remove('workspace-is-resizing');
  }, [cleanupTrackRenderer, handleWindowBlur]);

  const collapsePane = useCallback((pane: ResizablePane) => {
    if (preferenceRef.current[pane].collapsed) return;

    commitPreference(
      collapsePanePreference(
        preferenceRef.current,
        pane,
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
      startEffectiveWidth: renderedTracksRef.current[pane].effectiveWidth,
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
    const requestedEffectiveWidth = activeDrag.startEffectiveWidth
      + event.clientX
      - activeDrag.startClientX;
    const nextCollapseArmed = isCollapseArmed(pane, requestedEffectiveWidth);
    if (activeDrag.collapseArmed !== nextCollapseArmed) {
      activeDrag.collapseArmed = nextCollapseArmed;
      setCollapseArmedPane(nextCollapseArmed ? pane : null);
    }

    const currentContainerWidth = getContainerWidth();
    const resizeIntent = resolvePaneResizeIntent({
      pane,
      requestedEffectiveWidth,
      preference: preferenceRef.current,
      containerWidth: currentContainerWidth,
    });
    pendingPreferenceRef.current = resizeIntent.effectiveWidthChanged
      ? resizeIntent.nextPreference
      : null;
    queueTrackWrite(resizeIntent.tracks);
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
    const currentEffectiveWidth = renderedTracksRef.current[pane].effectiveWidth;
    const resizeIntent = resolvePaneResizeIntent({
      pane,
      requestedEffectiveWidth: currentEffectiveWidth + direction * step,
      preference: preferenceRef.current,
      containerWidth: getContainerWidth(),
    });
    if (resizeIntent.effectiveWidthChanged) {
      commitPreference(resizeIntent.nextPreference);
    }
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
