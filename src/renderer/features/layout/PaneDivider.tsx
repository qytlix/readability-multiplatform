import type { KeyboardEvent, PointerEvent } from 'react';
import type { ResizablePane } from './paneLayout';

interface PaneDividerProps {
  pane: ResizablePane;
  value: number;
  minimum: number;
  maximum: number;
  isDragging: boolean;
  onPointerDown: (pane: ResizablePane, event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (pane: ResizablePane, event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (pane: ResizablePane, event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (pane: ResizablePane, event: PointerEvent<HTMLDivElement>) => void;
  onLostPointerCapture: (
    pane: ResizablePane,
    event: PointerEvent<HTMLDivElement>,
  ) => void;
  onKeyDown: (pane: ResizablePane, event: KeyboardEvent<HTMLDivElement>) => void;
}

const dividerLabels: Record<ResizablePane, string> = {
  feed: 'Resize feed sidebar',
  entry: 'Resize article list',
};

export const PaneDivider = ({
  pane,
  value,
  minimum,
  maximum,
  isDragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onKeyDown,
}: PaneDividerProps) => (
  <div
    className={`pane-divider${isDragging ? ' is-dragging' : ''}`}
    role="separator"
    aria-orientation="vertical"
    aria-label={dividerLabels[pane]}
    aria-valuemin={minimum}
    aria-valuemax={maximum}
    aria-valuenow={Math.round(value)}
    tabIndex={0}
    onPointerDown={(event) => onPointerDown(pane, event)}
    onPointerMove={(event) => onPointerMove(pane, event)}
    onPointerUp={(event) => onPointerUp(pane, event)}
    onPointerCancel={(event) => onPointerCancel(pane, event)}
    onLostPointerCapture={(event) => onLostPointerCapture(pane, event)}
    onKeyDown={(event) => onKeyDown(pane, event)}
  />
);
