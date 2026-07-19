// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceLayout } from '../../src/renderer/features/layout/WorkspaceLayout';
import { PANE_LAYOUT_STORAGE_KEY } from '../../src/renderer/features/layout/paneLayoutStorage';

const constrainedContainerWidth = 1024;
const wideContainerWidth = 1440;
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const createRect = (width: number): DOMRect => ({
  x: 0,
  y: 0,
  width,
  height: 0,
  top: 0,
  right: width,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
}) as DOMRect;

const storedPreference = {
  version: 2,
  feed: { width: 340, collapsed: false },
  entry: { width: 560, collapsed: false },
};

const readStoredPreference = (): unknown => JSON.parse(
  window.localStorage.getItem(PANE_LAYOUT_STORAGE_KEY) ?? '',
);

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

describe('pane layout collapse interactions', () => {
  let root: Root | null;
  let container: HTMLDivElement;
  let workspaceWidth: number;
  let resizeCallbacks: Array<() => void>;

  const mountWorkspace = (width: number): void => {
    workspaceWidth = width;
    root = createRoot(container);
    act(() => {
      root?.render(createElement(WorkspaceLayout, {
        feedPane: createElement('div'),
        entryPane: createElement('div'),
        readerPane: createElement('div'),
      }));
    });
  };

  const unmountWorkspace = (): void => {
    act(() => {
      root?.unmount();
    });
    root = null;
  };

  const notifyWorkspaceResize = (): void => {
    resizeCallbacks.forEach((notifyResize) => notifyResize());
  };

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    workspaceWidth = constrainedContainerWidth;
    root = null;
    resizeCallbacks = [];
    window.localStorage.clear();
    window.localStorage.setItem(
      PANE_LAYOUT_STORAGE_KEY,
      JSON.stringify(storedPreference),
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(
      this: HTMLElement,
    ) {
      return createRect(
        this.classList.contains('workspace-layout') ? workspaceWidth : 0,
      );
    });
    vi.stubGlobal('ResizeObserver', class ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(() => {
          callback([], this as unknown as ResizeObserver);
        });
      }

      observe() {}

      disconnect() {}

      unobserve() {}
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

    container = document.createElement('div');
    document.body.append(container);
  });

  afterEach(() => {
    unmountWorkspace();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the preferred width through Enter collapse and rail restore', () => {
    mountWorkspace(constrainedContainerWidth);
    const divider = container.querySelector<HTMLDivElement>('.pane-divider');
    expect(divider).not.toBeNull();

    act(() => {
      divider?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
      }));
    });

    expect(readStoredPreference()).toEqual({
      version: 2,
      feed: { width: 340, collapsed: true },
      entry: { width: 560, collapsed: false },
    });

    const rail = container.querySelector<HTMLButtonElement>('.pane-rail-button');
    expect(rail).not.toBeNull();
    act(() => {
      rail?.click();
    });

    expect(readStoredPreference()).toEqual(storedPreference);
  });

  it('keeps the drag-start preferred width through drag collapse and rail restore', () => {
    mountWorkspace(constrainedContainerWidth);
    const divider = container.querySelector<HTMLDivElement>('.pane-divider');
    expect(divider).not.toBeNull();
    if (!divider) return;

    Object.defineProperties(divider, {
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: () => undefined },
      setPointerCapture: { value: () => undefined },
    });

    act(() => {
      dispatchPointerEvent(divider, 'pointerdown', 300);
      dispatchPointerEvent(divider, 'pointermove', 250);
      dispatchPointerEvent(divider, 'pointerup', 250);
    });

    expect(readStoredPreference()).toEqual({
      version: 2,
      feed: { width: 340, collapsed: true },
      entry: { width: 560, collapsed: false },
    });

    const rail = container.querySelector<HTMLButtonElement>('.pane-rail-button');
    expect(rail).not.toBeNull();
    act(() => {
      rail?.click();
    });

    expect(readStoredPreference()).toEqual(storedPreference);
  });

  it('does not save a pointer resize with no effective movement and restores the preference wide', () => {
    mountWorkspace(constrainedContainerWidth);
    const divider = container.querySelector<HTMLDivElement>('.pane-divider');
    expect(divider).not.toBeNull();
    if (!divider) return;

    Object.defineProperties(divider, {
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: () => undefined },
      setPointerCapture: { value: () => undefined },
    });
    const storageSetItem = vi.spyOn(Storage.prototype, 'setItem');

    act(() => {
      dispatchPointerEvent(divider, 'pointerdown', 300);
      dispatchPointerEvent(divider, 'pointermove', 320);
      dispatchPointerEvent(divider, 'pointerup', 320);
    });

    expect(storageSetItem).not.toHaveBeenCalled();
    expect(readStoredPreference()).toEqual(storedPreference);

    workspaceWidth = wideContainerWidth;
    act(() => {
      notifyWorkspaceResize();
    });
    expect(container.querySelector('.pane-divider')?.getAttribute('aria-valuenow')).toBe('340');
  });

  it('saves the preferred width after a pointer resize with visible movement', () => {
    mountWorkspace(1100);
    const divider = container.querySelector<HTMLDivElement>('.pane-divider');
    expect(divider).not.toBeNull();
    if (!divider) return;

    Object.defineProperties(divider, {
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: () => undefined },
      setPointerCapture: { value: () => undefined },
    });

    act(() => {
      dispatchPointerEvent(divider, 'pointerdown', 300);
      dispatchPointerEvent(divider, 'pointermove', 272);
      dispatchPointerEvent(divider, 'pointerup', 272);
    });

    expect(readStoredPreference()).toEqual({
      version: 2,
      feed: { width: 220, collapsed: false },
      entry: { width: 560, collapsed: false },
    });
  });

  it('does not save a keyboard resize with no effective movement', () => {
    mountWorkspace(constrainedContainerWidth);
    const divider = container.querySelector<HTMLDivElement>('.pane-divider');
    expect(divider).not.toBeNull();
    const storageSetItem = vi.spyOn(Storage.prototype, 'setItem');

    act(() => {
      divider?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'ArrowRight',
      }));
    });

    expect(storageSetItem).not.toHaveBeenCalled();
    expect(readStoredPreference()).toEqual(storedPreference);
  });

  it('saves the preferred width after a keyboard resize with visible movement', () => {
    mountWorkspace(1100);
    const divider = container.querySelector<HTMLDivElement>('.pane-divider');
    expect(divider).not.toBeNull();

    act(() => {
      divider?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'ArrowLeft',
      }));
    });

    expect(readStoredPreference()).toEqual({
      version: 2,
      feed: { width: 238, collapsed: false },
      entry: { width: 560, collapsed: false },
    });
  });
});
