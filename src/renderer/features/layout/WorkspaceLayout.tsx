import type { CSSProperties, ReactNode } from 'react';
import { PaneDivider } from './PaneDivider';
import { PANE_LAYOUT, getPaneBounds } from './paneLayout';
import { usePaneLayout } from './usePaneLayout';

interface WorkspaceLayoutProps {
  feedPane: ReactNode;
  entryPane: ReactNode;
  readerPane: ReactNode;
}

type WorkspaceStyle = CSSProperties & {
  '--workspace-feed-width': string;
  '--workspace-entry-width': string;
  '--workspace-divider-width': string;
  '--workspace-reader-min-width': string;
};

export const WorkspaceLayout = ({
  feedPane,
  entryPane,
  readerPane,
}: WorkspaceLayoutProps) => {
  const {
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
  } = usePaneLayout();
  const feedBounds = getPaneBounds('feed', widths.entryWidth, containerWidth);
  const entryBounds = getPaneBounds('entry', widths.feedWidth, containerWidth);
  const style: WorkspaceStyle = {
    '--workspace-feed-width': `${widths.feedWidth}px`,
    '--workspace-entry-width': `${widths.entryWidth}px`,
    '--workspace-divider-width': `${PANE_LAYOUT.dividerWidth}px`,
    '--workspace-reader-min-width': `${PANE_LAYOUT.readerMinWidth}px`,
  };

  return (
    <div ref={layoutRef} className="app-body workspace-layout" style={style}>
      <aside className="app-sidebar">
        {feedPane}
      </aside>

      <PaneDivider
        pane="feed"
        value={widths.feedWidth}
        minimum={feedBounds.minWidth}
        maximum={feedBounds.maxWidth}
        isDragging={draggingPane === 'feed'}
        onPointerDown={onDividerPointerDown}
        onPointerMove={onDividerPointerMove}
        onPointerUp={onDividerPointerUp}
        onPointerCancel={onDividerPointerCancel}
        onLostPointerCapture={onDividerLostPointerCapture}
        onKeyDown={onDividerKeyDown}
      />

      <main className="app-main">
        {entryPane}
      </main>

      <PaneDivider
        pane="entry"
        value={widths.entryWidth}
        minimum={entryBounds.minWidth}
        maximum={entryBounds.maxWidth}
        isDragging={draggingPane === 'entry'}
        onPointerDown={onDividerPointerDown}
        onPointerMove={onDividerPointerMove}
        onPointerUp={onDividerPointerUp}
        onPointerCancel={onDividerPointerCancel}
        onLostPointerCapture={onDividerLostPointerCapture}
        onKeyDown={onDividerKeyDown}
      />

      <aside className="app-detail">
        {readerPane}
      </aside>
    </div>
  );
};
