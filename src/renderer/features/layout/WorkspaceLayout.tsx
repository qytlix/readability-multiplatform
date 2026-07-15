import {
  useCallback,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { PaneDivider } from './PaneDivider';
import { PaneRail } from './PaneRail';
import { PANE_LAYOUT, getPaneBounds, type ResizablePane } from './paneLayout';
import { usePaneLayout } from './usePaneLayout';

interface WorkspaceLayoutProps {
  feedPane: ReactNode;
  entryPane: ReactNode;
  readerPane: ReactNode;
}

type WorkspaceStyle = CSSProperties & {
  '--workspace-feed-width': string;
  '--workspace-feed-divider-width': string;
  '--workspace-entry-width': string;
  '--workspace-entry-divider-width': string;
  '--workspace-reader-min-width': string;
};

export const WorkspaceLayout = ({
  feedPane,
  entryPane,
  readerPane,
}: WorkspaceLayoutProps) => {
  const {
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
  } = usePaneLayout();
  const feedDividerRef = useRef<HTMLDivElement>(null);
  const entryDividerRef = useRef<HTMLDivElement>(null);
  const feedRailRef = useRef<HTMLButtonElement>(null);
  const entryRailRef = useRef<HTMLButtonElement>(null);
  const feedBounds = getPaneBounds('feed', preference, containerWidth);
  const entryBounds = getPaneBounds('entry', preference, containerWidth);
  const style: WorkspaceStyle = {
    '--workspace-feed-width': `${tracks.feed.trackWidth}px`,
    '--workspace-feed-divider-width': `${tracks.feed.dividerWidth}px`,
    '--workspace-entry-width': `${tracks.entry.trackWidth}px`,
    '--workspace-entry-divider-width': `${tracks.entry.dividerWidth}px`,
    '--workspace-reader-min-width': `${PANE_LAYOUT.readerMinWidth}px`,
  };

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

  const handleRestore = useCallback((pane: ResizablePane) => {
    restorePane(pane);
    focusDivider(pane);
  }, [focusDivider, restorePane]);

  const handleDividerKeyDown = useCallback((
    pane: ResizablePane,
    event: KeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      collapsePane(pane);
      focusRail(pane);
      return;
    }

    onDividerKeyDown(pane, event);
  }, [collapsePane, focusRail, onDividerKeyDown]);

  const feedCollapsed = tracks.feed.collapsed;
  const entryCollapsed = tracks.entry.collapsed;

  return (
    <div ref={layoutRef} className="app-body workspace-layout" style={style}>
      <aside
        className={`app-sidebar pane-slot${feedCollapsed ? ' is-collapsed' : ''}${
          collapseArmedPane === 'feed' ? ' is-collapse-armed' : ''
        }`}
      >
        <div className="pane-content" aria-hidden={feedCollapsed} inert={feedCollapsed}>
          {feedPane}
        </div>
        {feedCollapsed && (
          <PaneRail ref={feedRailRef} pane="feed" onRestore={handleRestore} />
        )}
      </aside>

      {feedCollapsed ? (
        <div className="pane-divider-placeholder" aria-hidden="true" />
      ) : (
        <PaneDivider
          ref={feedDividerRef}
          pane="feed"
          value={tracks.feed.expandedWidth}
          minimum={feedBounds.minWidth}
          maximum={feedBounds.maxWidth}
          isDragging={draggingPane === 'feed'}
          isCollapseArmed={collapseArmedPane === 'feed'}
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={onDividerPointerUp}
          onPointerCancel={onDividerPointerCancel}
          onLostPointerCapture={onDividerLostPointerCapture}
          onKeyDown={handleDividerKeyDown}
        />
      )}

      <main
        className={`app-main pane-slot${entryCollapsed ? ' is-collapsed' : ''}${
          collapseArmedPane === 'entry' ? ' is-collapse-armed' : ''
        }`}
      >
        <div className="pane-content" aria-hidden={entryCollapsed} inert={entryCollapsed}>
          {entryPane}
        </div>
        {entryCollapsed && (
          <PaneRail ref={entryRailRef} pane="entry" onRestore={handleRestore} />
        )}
      </main>

      {entryCollapsed ? (
        <div className="pane-divider-placeholder" aria-hidden="true" />
      ) : (
        <PaneDivider
          ref={entryDividerRef}
          pane="entry"
          value={tracks.entry.expandedWidth}
          minimum={entryBounds.minWidth}
          maximum={entryBounds.maxWidth}
          isDragging={draggingPane === 'entry'}
          isCollapseArmed={collapseArmedPane === 'entry'}
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={onDividerPointerUp}
          onPointerCancel={onDividerPointerCancel}
          onLostPointerCapture={onDividerLostPointerCapture}
          onKeyDown={handleDividerKeyDown}
        />
      )}

      <aside className="app-detail">
        {readerPane}
      </aside>
    </div>
  );
};
