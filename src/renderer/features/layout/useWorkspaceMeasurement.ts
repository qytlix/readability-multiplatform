import {
  useCallback,
  useEffect,
  useRef,
  type RefObject,
} from 'react';

export type WorkspaceWidthChangeHandler = (measuredWidth: number | null) => void;

interface WorkspaceMeasurement {
  layoutRef: RefObject<HTMLDivElement | null>;
  readMeasuredWidth: () => number | null;
}

export const useWorkspaceMeasurement = (
  onWidthChange: WorkspaceWidthChangeHandler,
): WorkspaceMeasurement => {
  const layoutRef = useRef<HTMLDivElement>(null);
  const onWidthChangeRef = useRef(onWidthChange);
  onWidthChangeRef.current = onWidthChange;

  const readMeasuredWidth = useCallback((): number | null => {
    const measuredWidth = layoutRef.current?.getBoundingClientRect().width;
    return measuredWidth && Number.isFinite(measuredWidth) ? measuredWidth : null;
  }, []);

  useEffect(() => {
    const layoutElement = layoutRef.current;
    if (!layoutElement) return undefined;

    const notifyWidthChange = () => {
      onWidthChangeRef.current(readMeasuredWidth());
    };

    notifyWidthChange();
    const observer = new ResizeObserver(notifyWidthChange);
    observer.observe(layoutElement);

    return () => {
      observer.disconnect();
    };
  }, [readMeasuredWidth]);

  return { layoutRef, readMeasuredWidth };
};
