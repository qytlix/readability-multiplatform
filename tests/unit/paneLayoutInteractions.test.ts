// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceLayout } from '../../src/renderer/features/layout/WorkspaceLayout';
import { PANE_LAYOUT_STORAGE_KEY } from '../../src/renderer/features/layout/paneLayoutStorage';

const constrainedContainerWidth = 1024;
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
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    window.localStorage.setItem(
      PANE_LAYOUT_STORAGE_KEY,
      JSON.stringify(storedPreference),
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(
      this: HTMLElement,
    ) {
      return createRect(
        this.classList.contains('workspace-layout') ? constrainedContainerWidth : 0,
      );
    });
    vi.stubGlobal('ResizeObserver', class ResizeObserver {
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
    root = createRoot(container);
    act(() => {
      root.render(createElement(WorkspaceLayout, {
        feedPane: createElement('div'),
        entryPane: createElement('div'),
        readerPane: createElement('div'),
      }));
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the preferred width through Enter collapse and rail restore', () => {
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
});
