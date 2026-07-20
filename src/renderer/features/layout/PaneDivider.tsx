import {
  forwardRef,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { ResizablePane } from './paneLayout';

interface PaneDividerProps {
  pane: ResizablePane;
  effectiveWidth: number;
  minimum: number;
  maximum: number;
  isDragging: boolean;
  isCollapseArmed: boolean;
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

export const PaneDivider = forwardRef<HTMLDivElement, PaneDividerProps>(function PaneDivider(
  {
    pane,
    effectiveWidth,
    minimum,
    maximum,
    isDragging,
    isCollapseArmed,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    onKeyDown,
  },
  ref,
) {
  const className = [
    'pane-divider',
    isDragging ? 'is-dragging' : '',
    isCollapseArmed ? 'is-collapse-armed' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={ref}
      className={className}
      role="separator"
      aria-orientation="vertical"
      aria-label={dividerLabels[pane]}
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={Math.round(effectiveWidth)}
      title={`${dividerLabels[pane]}. Press Enter to collapse.`}
      tabIndex={0}
      onPointerDown={(event) => onPointerDown(pane, event)}
      onPointerMove={(event) => onPointerMove(pane, event)}
      onPointerUp={(event) => onPointerUp(pane, event)}
      onPointerCancel={(event) => onPointerCancel(pane, event)}
      onLostPointerCapture={(event) => onLostPointerCapture(pane, event)}
      onKeyDown={(event) => onKeyDown(pane, event)}
    >
      <svg className="pane-divider-collapse-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="m9.5 3.5-4 4.5 4 4.5" />
      </svg>
    </div>
  );
});
