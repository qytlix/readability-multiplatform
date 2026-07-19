import {
  useCallback,
  useRef,
  type RefObject,
} from 'react';
import type { ResizablePane } from './paneLayoutModel';

interface PaneFocusRestoration {
  feedDividerRef: RefObject<HTMLDivElement | null>;
  entryDividerRef: RefObject<HTMLDivElement | null>;
  feedRailRef: RefObject<HTMLButtonElement | null>;
  entryRailRef: RefObject<HTMLButtonElement | null>;
  focusRail: (pane: ResizablePane) => void;
  focusDivider: (pane: ResizablePane) => void;
}

export const usePaneFocusRestoration = (): PaneFocusRestoration => {
  const feedDividerRef = useRef<HTMLDivElement>(null);
  const entryDividerRef = useRef<HTMLDivElement>(null);
  const feedRailRef = useRef<HTMLButtonElement>(null);
  const entryRailRef = useRef<HTMLButtonElement>(null);

  const focusRail = useCallback((pane: ResizablePane) => {
    window.requestAnimationFrame(() => {
      const rail = pane === 'feed' ? feedRailRef.current : entryRailRef.current;
      rail?.focus();
    });
  }, []);

  const focusDivider = useCallback((pane: ResizablePane) => {
    window.requestAnimationFrame(() => {
      const divider = pane === 'feed' ? feedDividerRef.current : entryDividerRef.current;
      divider?.focus();
    });
  }, []);

  return {
    feedDividerRef,
    entryDividerRef,
    feedRailRef,
    entryRailRef,
    focusRail,
    focusDivider,
  };
};
