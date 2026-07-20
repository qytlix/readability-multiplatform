import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NORMAL_SHUTDOWN_FLUSH_TIMEOUT_MS,
  NormalShutdownCoordinator,
  type BeforeQuitEvent,
  type ShutdownLogger,
} from '../../../src/main/logging/NormalShutdownCoordinator';
import { MAIN_LIFECYCLE_EVENTS } from '../../../src/main/logging/MainLifecycleEvents';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function createBeforeQuitEvent() {
  return { preventDefault: vi.fn<() => void>() } satisfies BeforeQuitEvent;
}

function createLogger(flush: Promise<void>) {
  return {
    info: vi.fn<(event: string, component: string) => void>(),
    flush: vi.fn<() => Promise<void>>(() => flush),
  } satisfies ShutdownLogger;
}

async function settlePromiseCallbacks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('NormalShutdownCoordinator', () => {
  it('prevents the first quit, records shutdown once, and preserves cleanup', async () => {
    const flush = createDeferred<void>();
    const logger = createLogger(flush.promise);
    const stopApplicationWork = vi.fn();
    const requestQuit = vi.fn();
    const coordinator = new NormalShutdownCoordinator({
      getLogger: () => logger,
      stopApplicationWork,
      requestQuit,
    });
    const event = createBeforeQuitEvent();

    coordinator.handleBeforeQuit(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(
      MAIN_LIFECYCLE_EVENTS.shutdownRequested,
      'app.lifecycle',
    );
    expect(stopApplicationWork).toHaveBeenCalledOnce();
    expect(requestQuit).not.toHaveBeenCalled();

    flush.resolve();
    await settlePromiseCallbacks();
  });

  it('resumes quit after a completed flush and directly allows the internal second quit', async () => {
    vi.useFakeTimers();
    const flush = createDeferred<void>();
    const logger = createLogger(flush.promise);
    const stopApplicationWork = vi.fn();
    const requestQuit = vi.fn();
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const coordinator = new NormalShutdownCoordinator({
      getLogger: () => logger,
      stopApplicationWork,
      requestQuit,
    });

    coordinator.handleBeforeQuit(createBeforeQuitEvent());
    flush.resolve();
    expect(requestQuit).not.toHaveBeenCalled();
    await settlePromiseCallbacks();

    expect(requestQuit).toHaveBeenCalledOnce();
    expect(clearTimeoutSpy).toHaveBeenCalledOnce();

    const secondEvent = createBeforeQuitEvent();
    coordinator.handleBeforeQuit(secondEvent);
    expect(secondEvent.preventDefault).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledOnce();
    expect(stopApplicationWork).toHaveBeenCalledOnce();
    expect(requestQuit).toHaveBeenCalledOnce();
  });

  it('does not repeat logging, cleanup, or quit recovery for repeated quit requests', async () => {
    const flush = createDeferred<void>();
    const logger = createLogger(flush.promise);
    const stopApplicationWork = vi.fn();
    const requestQuit = vi.fn();
    const coordinator = new NormalShutdownCoordinator({
      getLogger: () => logger,
      stopApplicationWork,
      requestQuit,
    });
    const firstEvent = createBeforeQuitEvent();
    const repeatedEvent = createBeforeQuitEvent();

    coordinator.handleBeforeQuit(firstEvent);
    coordinator.handleBeforeQuit(repeatedEvent);

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(repeatedEvent.preventDefault).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledOnce();
    expect(stopApplicationWork).toHaveBeenCalledOnce();

    flush.resolve();
    await settlePromiseCallbacks();
    expect(requestQuit).toHaveBeenCalledOnce();
  });

  it('resumes quit after 500 ms when flush does not complete', async () => {
    vi.useFakeTimers();
    const logger = createLogger(new Promise<void>(() => undefined));
    const stopApplicationWork = vi.fn();
    const requestQuit = vi.fn();
    const coordinator = new NormalShutdownCoordinator({
      getLogger: () => logger,
      stopApplicationWork,
      requestQuit,
    });

    coordinator.handleBeforeQuit(createBeforeQuitEvent());
    vi.advanceTimersByTime(NORMAL_SHUTDOWN_FLUSH_TIMEOUT_MS - 1);
    expect(requestQuit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await settlePromiseCallbacks();
    expect(requestQuit).toHaveBeenCalledOnce();

    const secondEvent = createBeforeQuitEvent();
    coordinator.handleBeforeQuit(secondEvent);
    expect(secondEvent.preventDefault).not.toHaveBeenCalled();
    expect(stopApplicationWork).toHaveBeenCalledOnce();
  });

  it('keeps the original non-blocking exit path when no logger exists', () => {
    const stopApplicationWork = vi.fn();
    const requestQuit = vi.fn();
    const coordinator = new NormalShutdownCoordinator({
      getLogger: () => null,
      stopApplicationWork,
      requestQuit,
    });
    const event = createBeforeQuitEvent();

    coordinator.handleBeforeQuit(event);
    coordinator.handleBeforeQuit(createBeforeQuitEvent());

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(stopApplicationWork).toHaveBeenCalledOnce();
    expect(requestQuit).not.toHaveBeenCalled();
  });

  it('resumes quit when flush fails', async () => {
    vi.useFakeTimers();
    const logger = createLogger(Promise.reject(new Error('flush failed')));
    const requestQuit = vi.fn();
    const coordinator = new NormalShutdownCoordinator({
      getLogger: () => logger,
      stopApplicationWork: vi.fn(),
      requestQuit,
    });

    coordinator.handleBeforeQuit(createBeforeQuitEvent());
    await settlePromiseCallbacks();

    expect(requestQuit).toHaveBeenCalledOnce();
  });
});
