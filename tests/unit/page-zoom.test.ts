import { describe, expect, it, vi } from 'vitest';
import { getApplicationMenuTemplate } from '../../src/main/application-menu';
import {
  PAGE_ZOOM_FACTOR,
  initializePageZoom,
  installPageZoomInputGuard,
} from '../../src/main/page-zoom';

type Listener = (event: { preventDefault: () => void }, input?: unknown) => void;

const createWebContents = (initialZoomFactor: number) => {
  const listeners = new Map<string, Listener>();
  const onceListeners = new Map<string, Listener>();
  let zoomFactor = initialZoomFactor;

  const webContents = {
    on: vi.fn((event: string, listener: Listener) => {
      listeners.set(event, listener);
    }),
    once: vi.fn((event: string, listener: Listener) => {
      onceListeners.set(event, listener);
    }),
    setZoomFactor: vi.fn((factor: number) => {
      zoomFactor = factor;
    }),
  };

  const emit = (event: string, input?: unknown) => {
    const listener = listeners.get(event) ?? onceListeners.get(event);
    const preventDefault = vi.fn();
    listener?.({ preventDefault }, input);
    return preventDefault;
  };

  return {
    webContents,
    emit,
    getZoomFactor: () => zoomFactor,
  };
};

describe('fixed page zoom', () => {
  it.each(['darwin', 'win32', 'linux'])(
    'does not include a page zoom menu role on %s',
    (platform) => {
      const serializedTemplate = JSON.stringify(getApplicationMenuTemplate(platform));

      expect(serializedTemplate).not.toContain('zoomIn');
      expect(serializedTemplate).not.toContain('zoomOut');
      expect(serializedTemplate).not.toContain('resetZoom');
    },
  );

  it.each([0.9, 1.3])(
    'resets a persisted %s origin zoom after the main page finishes loading',
    (persistedZoom) => {
      const fake = createWebContents(persistedZoom);
      const onInitialized = vi.fn();

      initializePageZoom(fake.webContents as never, onInitialized);
      expect(fake.getZoomFactor()).toBe(persistedZoom);

      fake.emit('did-finish-load');

      expect(fake.getZoomFactor()).toBe(PAGE_ZOOM_FACTOR);
      expect(fake.webContents.setZoomFactor).toHaveBeenCalledWith(PAGE_ZOOM_FACTOR);
      expect(onInitialized).toHaveBeenCalledOnce();
    },
  );

  it('does not bind window state events that could change zoom', () => {
    const fake = createWebContents(PAGE_ZOOM_FACTOR);

    initializePageZoom(fake.webContents as never);
    installPageZoomInputGuard(fake.webContents as never);

    expect(fake.webContents.on.mock.calls.map(([event]) => event)).toEqual([
      'before-input-event',
      'zoom-changed',
    ]);
    expect(fake.getZoomFactor()).toBe(PAGE_ZOOM_FACTOR);
  });

  it.each([
    { key: '+', code: 'Equal', control: true },
    { key: '-', code: 'Minus', control: true },
    { key: '+', code: 'NumpadAdd', meta: true },
    { key: '-', code: 'NumpadSubtract', meta: true },
  ])('blocks the keyboard zoom request %#', (input) => {
    const fake = createWebContents(1.3);
    installPageZoomInputGuard(fake.webContents as never);

    const preventDefault = fake.emit('before-input-event', {
      type: 'keyDown',
      ...input,
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(fake.getZoomFactor()).toBe(PAGE_ZOOM_FACTOR);
  });

  it('keeps Actual Size at 100% when Ctrl/Cmd + 0 is requested', () => {
    const fake = createWebContents(0.9);
    installPageZoomInputGuard(fake.webContents as never);

    const preventDefault = fake.emit('before-input-event', {
      type: 'keyDown',
      key: '0',
      code: 'Digit0',
      control: true,
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(fake.getZoomFactor()).toBe(PAGE_ZOOM_FACTOR);
  });

  it('cancels Chromium wheel zoom requests and restores 100%', () => {
    const fake = createWebContents(1.3);
    installPageZoomInputGuard(fake.webContents as never);

    const preventDefault = fake.emit('zoom-changed', 'in');

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(fake.getZoomFactor()).toBe(PAGE_ZOOM_FACTOR);
  });

  it('does not intercept ordinary keys or unmodified scrolling input', () => {
    const fake = createWebContents(PAGE_ZOOM_FACTOR);
    installPageZoomInputGuard(fake.webContents as never);

    const plusPreventDefault = fake.emit('before-input-event', {
      type: 'keyDown',
      key: '+',
      code: 'Equal',
    });
    const scrollPreventDefault = fake.emit('before-input-event', {
      type: 'mouseWheel',
      control: false,
      meta: false,
    });

    expect(plusPreventDefault).not.toHaveBeenCalled();
    expect(scrollPreventDefault).not.toHaveBeenCalled();
    expect(fake.getZoomFactor()).toBe(PAGE_ZOOM_FACTOR);
  });
});
