import type { WebContents } from 'electron';
import type { FetchResult } from '../../../shared/contracts/content.types';

// ── Strategy Interface ─────────────────────────────────────────

export interface FetcherStrategy {
  /** Strategy name for logging and diagnostics */
  readonly name: string;

  /**
   * Fetch a URL and return the result.
   * @throws Error if fetching fails (e.g. HTTP error, network error)
   */
  fetch(
    url: string,
    signal?: AbortSignal,
    validate?: FetchCandidateValidator,
  ): Promise<FetchResult>;

  /**
   * Check if this strategy is available in the current runtime environment.
   * Returns false for strategies that require Electron Main process, etc.
   */
  isAvailable(): boolean;
}

export type FetchCandidateValidator = (
  result: FetchResult,
) => void | Promise<void>;

export type FetchImplementation = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

// ── Shared helpers (moved from original ContentFetcher) ─────────

export function extractCharset(contentType: string): string | null {
  const match = contentType.match(/charset\s*=\s*([^\s;]+)/i);
  return match ? match[1].toLowerCase() : null;
}

export function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

export function combineSignals(
  ...signals: (AbortSignal | undefined)[]
): AbortSignal {
  const controller = new AbortController();

  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), {
      once: true,
    });
  }

  return controller.signal;
}

// ── Default strategy options ───────────────────────────────────

export interface FetchStrategyOptions {
  maxSize: number;
  timeoutMs: number;
  fetchImplementation?: FetchImplementation;
}

const DEFAULT_OPTIONS: FetchStrategyOptions = {
  maxSize: 10 * 1024 * 1024, // 10MB
  timeoutMs: 10_000,          // 10s before falling back to the next transport
};

export class FetchStrategyTimeoutError extends Error {
  override readonly name = 'TimeoutError';

  constructor(strategyName: string) {
    super(`${strategyName} fetch timed out`);
  }
}

/** A response arrived but cannot supply an article body to the Content pipeline. */
export class FetchResponseUnavailableError extends Error {
  override readonly name = 'FetchResponseUnavailableError';
}

// ── Tier 0: SimpleFetchStrategy ────────────────────────────────

/**
 * Simple HTTP fetch with Shale/1.0 user-agent.
 * Matches the original ContentFetcher behavior exactly.
 */
export class SimpleFetchStrategy implements FetcherStrategy {
  readonly name = 'simple';
  private maxSize: number;
  private timeoutMs: number;
  private fetchImplementation?: FetchImplementation;

  constructor(options?: Partial<FetchStrategyOptions>) {
    this.maxSize = options?.maxSize ?? DEFAULT_OPTIONS.maxSize;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs;
    this.fetchImplementation = options?.fetchImplementation;
  }

  isAvailable(): boolean {
    return true;
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const controller = new AbortController();
    const combinedSignal = signal
      ? combineSignals(signal, controller.signal)
      : controller.signal;

    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const fetchImplementation =
        this.fetchImplementation ?? resolveFetchImplementation();
      const response = await fetchImplementation(url, {
        signal: combinedSignal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Shale/1.0 Feed Reader',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        throw new FetchResponseUnavailableError(
          `HTTP ${response.status}: ${response.statusText}`,
        );
      }

      const finalUrl = response.url || url;
      const contentType = response.headers.get('content-type') ?? '';
      const charset = extractCharset(contentType);

      // Read body with size limit
      const reader = response.body?.getReader();
      if (!reader) {
        throw new FetchResponseUnavailableError('No response body');
      }

      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalSize += value.length;
        if (totalSize > this.maxSize) {
          reader.cancel();
          throw new FetchResponseUnavailableError(
            `Response too large (exceeded ${this.maxSize} bytes)`,
          );
        }

        chunks.push(value);
      }

      const decoder = new TextDecoder(charset || 'utf-8');
      const body = decoder.decode(concatUint8Arrays(chunks));

      return {
        url: finalUrl,
        statusCode: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
        charset: charset || undefined,
      };
    } catch (error) {
      throw normalizeFetchError(error, signal, controller.signal, this.name);
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ── Tier 1: EnhancedFetchStrategy ──────────────────────────────

/** Pool of realistic browser User-Agent strings, rotated on 403 */
const BROWSER_UA_POOL = [
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

/** Backoff delays in ms for retries */
const RETRY_DELAYS = [100, 500, 2_000];

/** Status codes that trigger enhanced retry */
function isRetryableHttpStatus(status: number): boolean {
  return status === 403 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * Enhanced HTTP fetch with browser-like User-Agent rotation,
 * realistic request headers, and exponential backoff retry.
 */
export class EnhancedFetchStrategy implements FetcherStrategy {
  readonly name = 'enhanced';
  private maxSize: number;
  private timeoutMs: number;
  private maxRetries: number;
  private fetchImplementation?: FetchImplementation;

  constructor(options?: Partial<FetchStrategyOptions> & { maxRetries?: number }) {
    this.maxSize = options?.maxSize ?? DEFAULT_OPTIONS.maxSize;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs;
    this.fetchImplementation = options?.fetchImplementation;
    // Two retries are enough to distinguish a UA-specific rejection from a
    // site that needs Chromium, without delaying the browser fallback by tens
    // of seconds.
    this.maxRetries = options?.maxRetries ?? 2;
  }

  isAvailable(): boolean {
    return true;
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const origin = this.extractOrigin(url);
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      const uaIndex = attempt % BROWSER_UA_POOL.length;
      const controller = new AbortController();
      let receivedResponse = false;
      const combinedSignal = signal
        ? combineSignals(signal, controller.signal)
        : controller.signal;

      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const fetchImplementation =
          this.fetchImplementation ?? resolveFetchImplementation();
        const response = await fetchImplementation(url, {
          signal: combinedSignal,
          redirect: 'follow',
          headers: {
            'User-Agent': BROWSER_UA_POOL[uaIndex],
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'max-age=0',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            Referer: origin,
          },
        });
        receivedResponse = true;

        if (response.ok) {
          // Keep the deadline active while streaming the response body too.
          // Clearing it after headers allowed a stalled body to hang forever.
          const result = await this.readResponse(response, url);
          clearTimeout(timeout);
          return result;
        }

        if (isRetryableHttpStatus(response.status) && attempt < this.maxRetries) {
          // Retry with backoff
          const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
          clearTimeout(timeout);
          await sleep(delay);
          attempt++;
          continue;
        }

        // Non-retryable error — throw immediately
        throw new FetchResponseUnavailableError(
          `HTTP ${response.status}: ${response.statusText}`,
        );
      } catch (error) {
        clearTimeout(timeout);

        if (signal?.aborted) {
          throw normalizeFetchError(error, signal, controller.signal, this.name);
        }
        if (controller.signal.aborted) {
          throw new FetchStrategyTimeoutError(this.name);
        }

        // Once headers arrived, parsing/streaming/size failures are properties
        // of this response, not transient connection setup failures.
        if (receivedResponse) {
          throw error;
        }

        // Non-retryable HTTP error (e.g. 404) — re-throw immediately
        if (error instanceof Error && /^HTTP \d+/.test(error.message)) {
          throw error;
        }

        // Network error (fetch rejected) — retry if attempts remain
        if (attempt < this.maxRetries) {
          const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
          await sleep(delay);
          attempt++;
          continue;
        }

        throw error; // Out of retries
      }
    }

    // Should not reach here, but TypeScript safety
    throw new Error('Enhanced fetch failed after all retries');
  }

  private async readResponse(
    response: Response,
    requestUrl: string,
  ): Promise<FetchResult> {
    const finalUrl = response.url || requestUrl;
    const contentType = response.headers.get('content-type') ?? '';
    const charset = extractCharset(contentType);

    const reader = response.body?.getReader();
    if (!reader) {
      throw new FetchResponseUnavailableError('No response body');
    }

    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalSize += value.length;
      if (totalSize > this.maxSize) {
        reader.cancel();
        throw new FetchResponseUnavailableError(
          `Response too large (exceeded ${this.maxSize} bytes)`,
        );
      }

      chunks.push(value);
    }

    const decoder = new TextDecoder(charset || 'utf-8');
    const body = decoder.decode(concatUint8Arrays(chunks));

    return {
      url: finalUrl,
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
      charset: charset || undefined,
    };
  }

  private extractOrigin(urlString: string): string {
    try {
      const parsed = new URL(urlString);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return '';
    }
  }
}

// ── Tier 2: BrowserFetchStrategy ───────────────────────────────

/** Dynamic import helper for Electron — returns null outside Main process */
function electron(): typeof import('electron') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('electron');
  } catch {
    return null;
  }
}

/**
 * Keep the hidden article-fetch window focused on the main document.
 *
 * Readability cannot consume cross-origin frame contents, so loading advertising
 * and tracking frames only adds noise, latency, and avoidable TLS failures.
 * A failed subframe must also never fail an otherwise valid article load.
 */
export function installBrowserFetchNavigationGuards(
  webContents: WebContents,
  onMainFrameLoadFailure: (errorDescription: string) => void,
): void {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-frame-navigate', (details) => {
    if (!details.isMainFrame) {
      details.preventDefault();
    }
  });
  webContents.on(
    'did-fail-load',
    (
      _event,
      _errorCode,
      errorDescription,
      _validatedURL,
      isMainFrame,
    ) => {
      if (isMainFrame) {
        onMainFrameLoadFailure(errorDescription);
      }
    },
  );
}

/**
 * Browser-based fetch using Electron's BrowserWindow (headless rendering).
 * Only available in Electron Main process.
 * Falls back to statusCode=200 since the browser internalizes HTTP responses.
 */
export class BrowserFetchStrategy implements FetcherStrategy {
  readonly name = 'browser';
  private timeoutMs: number;

  constructor(options?: { timeoutMs?: number }) {
    this.timeoutMs = options?.timeoutMs ?? 30_000;
  }

  isAvailable(): boolean {
    // Only available in Electron Main process
    return typeof process !== 'undefined' && process.type === 'browser';
  }

  async fetch(
    url: string,
    signal?: AbortSignal,
    validate?: FetchCandidateValidator,
  ): Promise<FetchResult> {
    const electronModule = electron();
    if (!electronModule || !this.isAvailable()) {
      throw new Error('BrowserFetchStrategy is not available outside Electron Main process');
    }

    // Create a hidden BrowserWindow
    const win = new electronModule.BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        javascript: true,
      },
    });

    try {
      // Set up timeout + abort handling
      return await new Promise<FetchResult>((resolve, reject) => {
        let settled = false;
        let isChallengePage = false;
        let challengeDeadline = 0;
        let timer: ReturnType<typeof setTimeout>;
        let domReadyValidation: Promise<boolean> | undefined;
        let onAbort: (() => void) | undefined;

        const done = (err: Error | null, result?: FetchResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (signal && onAbort) {
            signal.removeEventListener('abort', onAbort);
          }
          if (err) reject(err);
          else if (result) resolve(result);
          else reject(new FetchResponseUnavailableError('Browser fetch completed without a result'));
        };

        const resetTimer = (ms?: number) => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            win.webContents.stop();
            done(new Error('Browser fetch timeout'));
          }, ms ?? this.timeoutMs);
        };

        // Listen for external abort signal
        if (signal) {
          onAbort = () => {
            win.webContents.stop();
            done(new DOMException('The operation was aborted', 'AbortError'));
          };
          if (signal.aborted) {
            done(new DOMException('The operation was aborted', 'AbortError'));
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        }

        // Helper: check if current page is a Cloudflare challenge
        const checkIsChallenge = async (): Promise<boolean> => {
          try {
            const title = await win.webContents.executeJavaScript('document.title').catch(() => '');
            const url_2 = win.webContents.getURL();
            return (
              title === 'Just a moment...' ||
              title.toLowerCase().includes('challenge') ||
              url_2.includes('__cf_chl_') ||
              url_2.includes('cf-ray')
            );
          } catch {
            return false;
          }
        };

        const captureCandidate = async (): Promise<FetchResult> => {
          const [html, charset] = await Promise.all([
            win.webContents.executeJavaScript(
              'document.documentElement.outerHTML',
            ) as Promise<string>,
            win.webContents.executeJavaScript(
              'document.characterSet',
            ).catch(() => undefined) as Promise<string | undefined>,
          ]);
          return {
            url: win.webContents.getURL(),
            statusCode: 200,
            headers: {},
            body: html,
            charset: charset || undefined,
          };
        };

        const captureAndValidate = async (
          failOnInvalid: boolean,
          skipChallengeCheck = false,
        ): Promise<boolean> => {
          try {
            if (!skipChallengeCheck && await checkIsChallenge()) return false;
            const candidate = await captureCandidate();
            await validate?.(candidate);
            done(null, candidate);
            return true;
          } catch (error) {
            if (failOnInvalid) {
              done(error instanceof Error ? error : new Error(String(error)));
            }
            return false;
          }
        };

        // Server-rendered article pages are often extractable as soon as the
        // DOM is ready. Validate with the real cleaner before accepting the
        // candidate so dynamic shells still wait for the full load fallback.
        if (validate) {
          win.webContents.on('dom-ready', () => {
            domReadyValidation = captureAndValidate(false);
          });
        }

        // After a page finishes loading
        win.webContents.on('did-finish-load', async () => {
          await domReadyValidation;
          if (settled) return;

          // Check if this is a challenge page that needs JS execution + redirect
          const isChallenge = await checkIsChallenge();

          if (isChallenge) {
            if (!isChallengePage) {
              // First time seeing a challenge page — start waiting for redirect
              isChallengePage = true;
              challengeDeadline = Date.now() + this.timeoutMs;

              // Reset timer for challenge wait (generous 20s)
              resetTimer(Math.min(this.timeoutMs, 20_000));

              // Try polling: Cloudflare challenge takes ~2-5s
              const poll = async () => {
                if (settled) return;
                if (Date.now() >= challengeDeadline) {
                  done(new Error('Cloudflare challenge did not resolve in time'));
                  return;
                }
                try {
                  const currentHtml = await win.webContents.executeJavaScript(
                    'document.documentElement.outerHTML',
                  ) as string;
                  if (settled) return;
                  const stillChallenge =
                    currentHtml.toLowerCase().includes('just a moment') ||
                    currentHtml.includes('cf_chl');
                  if (!stillChallenge) {
                    await captureAndValidate(true, true);
                  } else {
                    setTimeout(poll, 1000);
                  }
                } catch {
                  if (!settled) setTimeout(poll, 1000);
                }
              };
              setTimeout(poll, 2000); // Start polling 2s after first detection
            }
            // If we already detected challenge and another did-finish-load
            // fires (e.g. redirect), the code below will handle it
            return;
          }

          if (isChallengePage) {
            // We were on a challenge page, and now we landed on real content.
            await captureAndValidate(true);
            return;
          }

          await captureAndValidate(true);
        });

        installBrowserFetchNavigationGuards(
          win.webContents,
          (errorDescription) => {
            done(new Error(`Browser fetch failed: ${errorDescription}`));
          },
        );

        resetTimer();
        win.loadURL(url);
      });
    } finally {
      // Always destroy the window
      if (!win.isDestroyed()) {
        win.destroy();
      }
    }
  }
}

// ── Utility ────────────────────────────────────────────────────

function resolveFetchImplementation(): FetchImplementation {
  const electronModule = electron();
  if (
    typeof process !== 'undefined'
    && process.type === 'browser'
    && electronModule?.net?.fetch
  ) {
    // Electron net.fetch uses Chromium's network stack and the default
    // Session, including the user's system proxy configuration.
    return electronModule.net.fetch.bind(
      electronModule.net,
    ) as FetchImplementation;
  }
  return globalThis.fetch.bind(globalThis);
}

function normalizeFetchError(
  error: unknown,
  externalSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
  strategyName: string,
): Error {
  if (!externalSignal?.aborted && timeoutSignal.aborted) {
    return new FetchStrategyTimeoutError(strategyName);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
