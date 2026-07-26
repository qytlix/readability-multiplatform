import type { FetchResult } from '../../../shared/contracts/content.types';
import type { FetcherStrategy } from './FetchStrategy';
import {
  SimpleFetchStrategy,
  EnhancedFetchStrategy,
  BrowserFetchStrategy,
  FetchStrategyOptions,
} from './FetchStrategy';

export type { FetcherStrategy };
export {
  SimpleFetchStrategy,
  EnhancedFetchStrategy,
  BrowserFetchStrategy,
};

/** Default fallback chain: Simple → Enhanced → Browser */
function defaultStrategies(options: FetchStrategyOptions): FetcherStrategy[] {
  return [
    new SimpleFetchStrategy(options),
    new EnhancedFetchStrategy(options),
    new BrowserFetchStrategy(options),
  ];
}

export class ContentFetcher {
  private strategies: FetcherStrategy[];

  constructor(options?: {
    maxSize?: number;
    timeoutMs?: number;
    /** Override strategy chain (for testing). Defaults to Simple → Enhanced → Browser. */
    strategies?: FetcherStrategy[];
  }) {
    const opts: FetchStrategyOptions = {
      maxSize: options?.maxSize ?? 10 * 1024 * 1024,
      timeoutMs: options?.timeoutMs ?? 30_000,
    };
    this.strategies = options?.strategies ?? defaultStrategies(opts);
  }

  /**
   * Fetch article HTML with automatic fallback across strategies.
   * Tries each strategy in order; on failure proceeds to the next.
   * If all strategies fail, throws the last error encountered.
   */
  async fetch(
    url: string,
    signal?: AbortSignal,
    validate?: (result: FetchResult) => void | Promise<void>,
  ): Promise<FetchResult> {
    return this.fetchValidated(url, signal, validate);
  }

  /**
   * Fetch until a strategy returns a response the caller can actually use.
   * A 200 challenge/app shell is not article success, so content extraction can
   * reject a candidate and let the next transport try.
   */
  private async fetchValidated(
    url: string,
    signal?: AbortSignal,
    validate?: (result: FetchResult) => void | Promise<void>,
  ): Promise<FetchResult> {
    let lastError: Error | null = null;
    let skipEnhancedHttpTransport = false;
    const browserFallbackAvailable = this.strategies.some(
      (strategy) => strategy.name === 'browser' && strategy.isAvailable(),
    );

    for (const strategy of this.strategies) {
      if (!strategy.isAvailable()) continue;
      if (skipEnhancedHttpTransport && strategy.name === 'enhanced') continue;
      let responseReceived = false;

      try {
        const result = await strategy.fetch(url, signal);
        responseReceived = true;
        await validate?.(result);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (signal?.aborted) {
          throw lastError;
        }
        if (
          strategy.name === 'simple'
          && browserFallbackAvailable
          && !responseReceived
          && isNodeFetchTransportFailure(lastError)
        ) {
          // Enhanced uses the same Node/Undici transport. Repeating a transport
          // failure with different headers only delays the Chromium fallback.
          skipEnhancedHttpTransport = true;
        }
      }
    }

    throw lastError ?? new Error('All fetch strategies failed');
  }
}

function isNodeFetchTransportFailure(error: Error): boolean {
  return error instanceof TypeError
    && /fetch failed|network|socket|connect/i.test(error.message);
}
