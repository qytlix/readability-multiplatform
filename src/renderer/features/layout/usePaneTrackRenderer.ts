import {
  useCallback,
  useRef,
  type RefObject,
} from 'react';
import type { PaneTrackLayout } from './paneLayoutModel';
import { writeWorkspaceCssVariables } from './paneLayoutCssVariables';

interface PaneTrackRenderer {
  renderedTracksRef: RefObject<PaneTrackLayout>;
  writeTracks: (tracks: PaneTrackLayout) => void;
  queueTrackWrite: (tracks: PaneTrackLayout) => void;
  flushPendingTracks: () => void;
  cleanupTrackRenderer: () => void;
}

export const usePaneTrackRenderer = (
  layoutRef: RefObject<HTMLDivElement | null>,
  initialTracks: PaneTrackLayout,
): PaneTrackRenderer => {
  const renderedTracksRef = useRef<PaneTrackLayout>(initialTracks);
  const pendingTracksRef = useRef<PaneTrackLayout | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const writeTracks = useCallback((nextTracks: PaneTrackLayout) => {
    renderedTracksRef.current = nextTracks;
    const layoutElement = layoutRef.current;
    if (!layoutElement) return;

    writeWorkspaceCssVariables(layoutElement, nextTracks);
  }, [layoutRef]);

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

  const cleanupTrackRenderer = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
  }, []);

  return {
    renderedTracksRef,
    writeTracks,
    queueTrackWrite,
    flushPendingTracks,
    cleanupTrackRenderer,
  };
};
