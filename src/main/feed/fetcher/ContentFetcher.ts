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
  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    let lastError: Error | null = null;

    for (const strategy of this.strategies) {
      if (!strategy.isAvailable()) continue;

      try {
        return await strategy.fetch(url, signal);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError ?? new Error('All fetch strategies failed');
  }
}