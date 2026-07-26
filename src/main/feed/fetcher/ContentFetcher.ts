import { performance } from 'node:perf_hooks';
import type { FetchResult } from '../../../shared/contracts/content.types';
import {
  type FetchCandidateValidator,
  type FetchImplementation,
  type FetcherStrategy,
  type FetchStrategyOptions,
  SimpleFetchStrategy,
  EnhancedFetchStrategy,
  BrowserFetchStrategy,
  FetchStrategyTimeoutError,
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
    fetchImplementation?: FetchImplementation;
    /** Override strategy chain (for testing). Defaults to Simple → Enhanced → Browser. */
    strategies?: FetcherStrategy[];
  }) {
    const opts: FetchStrategyOptions = {
      maxSize: options?.maxSize ?? 10 * 1024 * 1024,
      timeoutMs: options?.timeoutMs ?? 10_000,
      fetchImplementation: options?.fetchImplementation,
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
    validate?: FetchCandidateValidator,
    onDiagnostics?: (diagnostics: ContentFetchDiagnostics) => void,
  ): Promise<FetchResult> {
    return this.fetchValidated(url, signal, validate, onDiagnostics);
  }

  /**
   * Fetch until a strategy returns a response the caller can actually use.
   * A 200 challenge/app shell is not article success, so content extraction can
   * reject a candidate and let the next transport try.
   */
  private async fetchValidated(
    url: string,
    signal?: AbortSignal,
    validate?: FetchCandidateValidator,
    onDiagnostics?: (diagnostics: ContentFetchDiagnostics) => void,
  ): Promise<FetchResult> {
    let lastError: Error | null = null;
    let skipEnhancedHttpTransport = false;
    let attemptCount = 0;
    const startedAt = performance.now();
    const browserFallbackAvailable = this.strategies.some(
      (strategy) => strategy.name === 'browser' && strategy.isAvailable(),
    );

    for (const strategy of this.strategies) {
      if (!strategy.isAvailable()) continue;
      if (skipEnhancedHttpTransport && strategy.name === 'enhanced') continue;
      let responseReceived = false;

      try {
        attemptCount += 1;
        let validatedResult: FetchResult | undefined;
        const recordValidation: FetchCandidateValidator = async (candidate) => {
          await validate?.(candidate);
          validatedResult = candidate;
        };
        const result = validate
          ? await strategy.fetch(url, signal, recordValidation)
          : await strategy.fetch(url, signal);
        responseReceived = true;
        if (validate && validatedResult !== result) {
          await recordValidation(result);
        }
        onDiagnostics?.({
          strategy: strategy.name,
          attemptCount,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        });
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (signal?.aborted) {
          throw lastError;
        }
        if (
          strategy.name === 'simple'
          && browserFallbackAvailable
          && (
            lastError instanceof FetchStrategyTimeoutError
            || (!responseReceived && isNodeFetchTransportFailure(lastError))
          )
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

export interface ContentFetchDiagnostics {
  strategy: string;
  attemptCount: number;
  durationMs: number;
}

function isNodeFetchTransportFailure(error: Error): boolean {
  return error instanceof TypeError
    && /fetch failed|network|socket|connect/i.test(error.message);
}
