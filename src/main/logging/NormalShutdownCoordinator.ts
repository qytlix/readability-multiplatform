import { MAIN_LIFECYCLE_EVENTS } from './MainLifecycleEvents';

export const NORMAL_SHUTDOWN_FLUSH_TIMEOUT_MS = 500;

export interface BeforeQuitEvent {
  preventDefault(): void;
}

export interface ShutdownLogger {
  info(event: string, component: string): void;
  flush(): Promise<void>;
}

export interface NormalShutdownCoordinatorOptions {
  getLogger(): ShutdownLogger | null;
  stopApplicationWork(): void;
  requestQuit(): void;
}

type ShutdownState = 'idle' | 'flushing' | 'readyToQuit';

/**
 * Coordinates one best-effort flush during a normal Electron quit. It does
 * not observe forced termination or operating-system shutdown paths.
 */
export class NormalShutdownCoordinator {
  private state: ShutdownState = 'idle';
  private quitRequested = false;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: NormalShutdownCoordinatorOptions) {}

  handleBeforeQuit(event: BeforeQuitEvent): void {
    if (this.state === 'readyToQuit') return;

    if (this.state === 'flushing') {
      event.preventDefault();
      return;
    }

    const logger = this.options.getLogger();
    if (!logger) {
      this.state = 'readyToQuit';
      this.options.stopApplicationWork();
      return;
    }

    event.preventDefault();
    this.state = 'flushing';
    try {
      logger.info(MAIN_LIFECYCLE_EVENTS.shutdownRequested, 'app.lifecycle');
    } catch {
      // Logging must not prevent a normal application exit.
    }

    try {
      this.options.stopApplicationWork();
    } finally {
      this.waitForFlush(logger);
    }
  }

  private waitForFlush(logger: ShutdownLogger): void {
    this.timeoutHandle = setTimeout(
      () => this.completeFlush(),
      NORMAL_SHUTDOWN_FLUSH_TIMEOUT_MS,
    );

    try {
      void logger.flush().then(
        () => this.completeFlush(),
        () => this.completeFlush(),
      );
    } catch {
      this.completeFlush();
    }
  }

  private completeFlush(): void {
    if (this.state !== 'flushing') return;

    this.state = 'readyToQuit';
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    queueMicrotask(() => this.requestQuitOnce());
  }

  private requestQuitOnce(): void {
    if (this.quitRequested) return;

    this.quitRequested = true;
    this.options.requestQuit();
  }
}
