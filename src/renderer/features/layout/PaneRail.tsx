import { forwardRef } from 'react';
import type { ResizablePane } from './paneLayout';

interface PaneRailProps {
  pane: ResizablePane;
  onRestore: (pane: ResizablePane) => void;
}

const railLabels: Record<ResizablePane, string> = {
  feed: 'Open feed sidebar',
  entry: 'Open article list',
};

const RailIcon = ({ pane }: { pane: ResizablePane }) => (
  <svg className="pane-rail-icon" viewBox="0 0 24 24" aria-hidden="true">
    {pane === 'feed' ? (
      <>
        <path d="M5.5 5.5h5.75a2.75 2.75 0 0 1 2.75 2.75V19H8.25A2.75 2.75 0 0 0 5.5 21.75V5.5Z" />
        <path d="M18.5 5.5h-5.75A2.75 2.75 0 0 0 10 8.25V19h5.75a2.75 2.75 0 0 1 2.75 2.75V5.5Z" />
      </>
    ) : (
      <>
        <path d="M6.25 6.5h11.5M6.25 12h11.5M6.25 17.5h11.5" />
        <path d="M3.75 6.5h.01M3.75 12h.01M3.75 17.5h.01" />
      </>
    )}
  </svg>
);

export const PaneRail = forwardRef<HTMLButtonElement, PaneRailProps>(function PaneRail(
  { pane, onRestore },
  ref,
) {
  const label = railLabels[pane];

  return (
    <button
      ref={ref}
      type="button"
      className="pane-rail-button"
      aria-label={label}
      title={label}
      onClick={() => onRestore(pane)}
    >
      <RailIcon pane={pane} />
    </button>
  );
});
