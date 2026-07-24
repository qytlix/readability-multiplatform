// @vitest-environment jsdom

import {
  act,
  createElement,
  useRef,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { PaneDivider } from '../../../src/renderer/features/layout/PaneDivider';
import {
  getReaderPaneBounds,
  useReaderPaneResize,
} from '../../../src/renderer/features/layout/useReaderPaneResize';
import { PANE_LAYOUT_STORAGE_KEY } from '../../../src/renderer/features/layout/paneLayoutStorage';

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const createRect = (width: number, left = 0): DOMRect => ({
  x: left,
  y: 0,
  width,
  height: 0,
  top: 0,
  right: left + width,
  bottom: 0,
  left,
  toJSON: () => ({}),
}) as DOMRect;

const dispatchPointerEvent = (
  target: HTMLElement,
  type: string,
  clientX: number,
): void => {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
};

const ResizeHarness = () => {
  const storyListRef = useRef<HTMLElement>(null);
  const controls = useReaderPaneResize({
    storyListRef,
    sidebarOpen: true,
    readingFocus: false,
  });

  return createElement(
    'div',
    {
      ref: controls.workspaceRef,
      className: 'reader-workspace',
    },
    createElement('section', {
      ref: storyListRef,
      className: 'story-list-pane',
    }),
    createElement(PaneDivider, {
      pane: 'entry',
      canCollapse: false,
      effectiveWidth: controls.effectiveWidth,
      minimum: controls.minimum,
      maximum: controls.maximum,
      isDragging: controls.isDragging,
      isCollapseArmed: false,
      onPointerDown: (_pane, event) => controls.onPointerDown(event),
      onPointerMove: (_pane, event) => controls.onPointerMove(event),
      onPointerUp: (_pane, event) => controls.onPointerUp(event),
      onPointerCancel: (_pane, event) => controls.onPointerCancel(event),
      onLostPointerCapture: (_pane, event) =>
        controls.onLostPointerCapture(event),
      onKeyDown: (_pane, event) => controls.onKeyDown(event),
    }),
  );
};

describe('reader pane resize bounds', () => {
  it('uses the configured maximum when both panes have enough room', () => {
    expect(getReaderPaneBounds(1440, 272)).toEqual({
      minimum: 360,
      maximum: 560,
    });
  });

  it('reserves the reader minimum width before allowing the list to grow', () => {
    expect(getReaderPaneBounds(1180, 272)).toEqual({
      minimum: 360,
      maximum: 422,
    });
  });

  it('keeps the article list usable when the window cannot fit both minima', () => {
    expect(getReaderPaneBounds(700, 0)).toEqual({
      minimum: 360,
      maximum: 360,
    });
  });

  it('falls back to the configured range before the workspace is measurable', () => {
    expect(getReaderPaneBounds(0, 0)).toEqual({
      minimum: 360,
      maximum: 560,
    });
  });
});

describe('reader pane resize interactions', () => {
  let root: Root | null;
  let container: HTMLDivElement;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    root = null;
    window.localStorage.clear();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function getRect(this: HTMLElement) {
        if (this.classList.contains('reader-workspace')) return createRect(1180);
        if (this.classList.contains('story-list-pane')) return createRect(400, 272);
        return createRect(0);
      },
    );
    vi.stubGlobal('ResizeObserver', class ResizeObserver {
      observe = vi.fn();

      disconnect = vi.fn();

      unobserve = vi.fn();
    });

    container = document.createElement('div');
    document.body.append(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
    document.body.classList.remove('workspace-is-resizing');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('drags the boundary, updates the CSS track, and saves the chosen width', () => {
    root = createRoot(container);
    act(() => {
      root?.render(createElement(ResizeHarness));
    });

    const divider = container.querySelector<HTMLDivElement>('.pane-divider');
    const workspace = container.querySelector<HTMLDivElement>('.reader-workspace');
    expect(divider).not.toBeNull();
    expect(workspace).not.toBeNull();
    if (!divider || !workspace) return;

    Object.defineProperties(divider, {
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: () => undefined },
      setPointerCapture: { value: () => undefined },
    });

    act(() => {
      dispatchPointerEvent(divider, 'pointerdown', 400);
      dispatchPointerEvent(divider, 'pointermove', 420);
      dispatchPointerEvent(divider, 'pointerup', 420);
    });

    expect(workspace.style.getPropertyValue('--reader-list-width')).toBe('420px');
    expect(divider.getAttribute('aria-valuenow')).toBe('420');
    expect(JSON.parse(
      window.localStorage.getItem(PANE_LAYOUT_STORAGE_KEY) ?? '',
    )).toMatchObject({
      entry: { width: 420, collapsed: false },
    });
    expect(document.body.classList.contains('workspace-is-resizing')).toBe(false);
  });
});
