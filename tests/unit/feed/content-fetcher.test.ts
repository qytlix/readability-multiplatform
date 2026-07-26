import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContentFetcher } from '../../../src/main/feed/fetcher/ContentFetcher';
import {
  FetchStrategyTimeoutError,
  type FetcherStrategy,
} from '../../../src/main/feed/fetcher/FetchStrategy';
import type { FetchResult } from '../../../src/shared/contracts/content.types';

function setMockFetch(fn: (...args: any[]) => any): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = fn;
}

function mockResponse(
  status: number,
  body: string,
  opts?: {
    charset?: string;
    finalUrl?: string;
    maxSize?: number;
  },
) {
  return (_url: string, init?: { signal?: AbortSignal }) => {
    // Check abort signal
    if (init?.signal?.aborted) {
      return Promise.reject(new DOMException('The operation was aborted', 'AbortError'));
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(body);

    // If maxSize is set, return a chunk larger than maxSize
    const chunkValue =
      opts?.maxSize !== undefined && data.length < opts.maxSize
        ? new Uint8Array(opts.maxSize + 1)
        : data;

    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: chunkValue })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      url: opts?.finalUrl ?? 'https://example.com/article',
      headers: {
        get: (name: string) => {
          if (name === 'content-type' && opts?.charset) {
            return opts.charset;
          }
          return null;
        },
        entries: () => [],
      },
      body: { getReader: () => reader },
    });
  };
}

// ── Mock strategy helpers for fallback tests ────────────────────

function mockStrategy(name: string, result: FetchResult | Error): FetcherStrategy {
  return {
    name,
    isAvailable: () => true,
    fetch: vi.fn().mockImplementation(() => {
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result);
    }),
  };
}

function mockStrategyUnavailable(name: string): FetcherStrategy {
  return {
    name,
    isAvailable: () => false,
    fetch: vi.fn().mockRejectedValue(new Error('Should not be called')),
  };
}

describe('ContentFetcher', () => {
  const htmlBody = '<html><body><article>Test Content</article></body></html>';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch and return article HTML', async () => {
    setMockFetch(mockResponse(200, htmlBody, { charset: 'text/html; charset=utf-8' }));

    const fetcher = new ContentFetcher();
    const result = await fetcher.fetch('https://example.com/article');

    expect(result.body).toBe(htmlBody);
    expect(result.statusCode).toBe(200);
    expect(result.charset).toBe('utf-8');
  });

  it('should extract charset from content-type', async () => {
    setMockFetch(mockResponse(200, htmlBody, { charset: 'text/html; charset=gb2312' }));

    const fetcher = new ContentFetcher();
    const result = await fetcher.fetch('https://example.com/article');

    expect(result.charset).toBe('gb2312');
  });

  it('should follow redirects and return final URL', async () => {
    setMockFetch(mockResponse(200, htmlBody, { finalUrl: 'https://example.com/final-article' }));

    const fetcher = new ContentFetcher();
    const result = await fetcher.fetch('https://example.com/redirect');

    expect(result.url).toBe('https://example.com/final-article');
  });

  it('should reject non-OK responses', async () => {
    setMockFetch(mockResponse(404, 'Not Found'));

    const fetcher = new ContentFetcher();
    await expect(
      fetcher.fetch('https://example.com/404'),
    ).rejects.toThrow('HTTP 404');
  });

  it('should enforce size limit', async () => {
    setMockFetch(mockResponse(200, htmlBody, { maxSize: 1024 }));

    const fetcher = new ContentFetcher({ maxSize: 1024 });
    await expect(
      fetcher.fetch('https://example.com/large'),
    ).rejects.toThrow('Response too large');
  });

  it('should respect AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Aborted', 'AbortError'));

    // Mock that also checks signal.aborted
    setMockFetch((_url: string, init?: { signal?: AbortSignal }) => {
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException('The operation was aborted', 'AbortError'));
      }
      return mockResponse(200, htmlBody)('https://example.com/article');
    });

    const fetcher = new ContentFetcher();
    await expect(
      fetcher.fetch('https://example.com/article', controller.signal),
    ).rejects.toThrow('aborted');
  });

  it('should timeout on slow responses', async () => {
    // Mock fetch that never resolves, but rejects when aborted
    setMockFetch(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (init?.signal) {
            if (init.signal.aborted) {
              reject(new DOMException('The operation was aborted', 'AbortError'));
              return;
            }
            init.signal.addEventListener(
              'abort',
              () => reject(new DOMException('The operation was aborted', 'AbortError')),
              { once: true },
            );
          }
        }),
    );

    const fetcher = new ContentFetcher({ timeoutMs: 50 });
    await expect(
      fetcher.fetch('https://example.com/slow'),
    ).rejects.toThrow('enhanced fetch timed out');
  }, 10_000);

  // ── Fallback chain tests ─────────────────────────────────

  it('should use first strategy when it succeeds', async () => {
    const successResult: FetchResult = {
      url: 'https://example.com/article',
      statusCode: 200,
      headers: {},
      body: htmlBody,
    };

    const strategies = [
      mockStrategy('tier0', successResult),
      mockStrategy('tier1', new Error('Should not be reached')),
    ];

    const fetcher = new ContentFetcher({ strategies });
    const result = await fetcher.fetch('https://example.com/article');

    expect(result).toBe(successResult);
    expect((strategies[0].fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((strategies[1].fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('should fallback to second strategy when first fails', async () => {
    const fallbackResult: FetchResult = {
      url: 'https://example.com/article',
      statusCode: 200,
      headers: {},
      body: htmlBody,
    };

    const strategies = [
      mockStrategy('tier0', new Error('Tier 0 failed')),
      mockStrategy('tier1', fallbackResult),
    ];

    const fetcher = new ContentFetcher({ strategies });
    const result = await fetcher.fetch('https://example.com/article');

    expect(result).toBe(fallbackResult);
    expect((strategies[0].fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((strategies[1].fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('should cascade through all strategies', async () => {
    const finalResult: FetchResult = {
      url: 'https://example.com/article',
      statusCode: 200,
      headers: {},
      body: htmlBody,
    };

    const strategies = [
      mockStrategy('tier0', new Error('Tier 0 failed')),
      mockStrategy('tier1', new Error('Tier 1 failed')),
      mockStrategy('tier2', finalResult),
    ];

    const fetcher = new ContentFetcher({ strategies });
    const result = await fetcher.fetch('https://example.com/article');

    expect(result).toBe(finalResult);
    expect((strategies[0].fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((strategies[1].fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((strategies[2].fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('should continue when a 200 response fails article validation', async () => {
    const shellResult: FetchResult = {
      url: 'https://example.com/article',
      statusCode: 200,
      headers: {},
      body: '<html><body>Access verification</body></html>',
    };
    const articleResult: FetchResult = {
      ...shellResult,
      body: htmlBody,
    };
    const strategies = [
      mockStrategy('simple', shellResult),
      mockStrategy('browser', articleResult),
    ];
    const validate = vi.fn((candidate: FetchResult) => {
      if (!candidate.body.includes('<article>')) {
        throw new Error('Readability could not extract content');
      }
    });

    const fetcher = new ContentFetcher({ strategies });
    const result = await fetcher.fetch(
      'https://example.com/article',
      undefined,
      validate,
    );

    expect(result).toBe(articleResult);
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it('skips redundant enhanced retries after a Node transport failure', async () => {
    const browserResult: FetchResult = {
      url: 'https://example.com/article',
      statusCode: 200,
      headers: {},
      body: htmlBody,
    };
    const simple = mockStrategy('simple', new TypeError('fetch failed'));
    const enhanced = mockStrategy('enhanced', new Error('should be skipped'));
    const browser = mockStrategy('browser', browserResult);
    const fetcher = new ContentFetcher({
      strategies: [simple, enhanced, browser],
    });

    await expect(fetcher.fetch('https://example.com/article')).resolves.toBe(
      browserResult,
    );
    expect(enhanced.fetch).not.toHaveBeenCalled();
    expect(browser.fetch).toHaveBeenCalledTimes(1);
  });

  it('skips redundant enhanced retries after an internal HTTP timeout', async () => {
    const browserResult: FetchResult = {
      url: 'https://example.com/article',
      statusCode: 200,
      headers: {},
      body: htmlBody,
    };
    const simple = mockStrategy(
      'simple',
      new FetchStrategyTimeoutError('simple'),
    );
    const enhanced = mockStrategy('enhanced', new Error('should be skipped'));
    const browser = mockStrategy('browser', browserResult);
    const fetcher = new ContentFetcher({
      strategies: [simple, enhanced, browser],
    });

    await expect(fetcher.fetch('https://example.com/article')).resolves.toBe(
      browserResult,
    );
    expect(enhanced.fetch).not.toHaveBeenCalled();
    expect(browser.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not validate a candidate twice when a strategy validates early', async () => {
    const browserResult: FetchResult = {
      url: 'https://example.com/article',
      statusCode: 200,
      headers: {},
      body: htmlBody,
    };
    const browser: FetcherStrategy = {
      name: 'browser',
      isAvailable: () => true,
      fetch: vi.fn(async (_url, _signal, validate) => {
        await validate?.(browserResult);
        return browserResult;
      }),
    };
    const validate = vi.fn();
    const fetcher = new ContentFetcher({ strategies: [browser] });

    await expect(
      fetcher.fetch(
        'https://example.com/article',
        undefined,
        validate,
      ),
    ).resolves.toBe(browserResult);
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it('reports the selected strategy and attempt count', async () => {
    const result: FetchResult = {
      url: 'https://example.com/article',
      statusCode: 200,
      headers: {},
      body: htmlBody,
    };
    const diagnostics = vi.fn();
    const fetcher = new ContentFetcher({
      strategies: [
        mockStrategy('simple', new Error('first failed')),
        mockStrategy('browser', result),
      ],
    });

    await fetcher.fetch(
      'https://example.com/article',
      undefined,
      undefined,
      diagnostics,
    );

    expect(diagnostics).toHaveBeenCalledWith({
      strategy: 'browser',
      attemptCount: 2,
      durationMs: expect.any(Number),
    });
  });

  it('does not start fallback strategies after cancellation', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    const first = mockStrategy('simple', abortError);
    const fallback = mockStrategy('browser', new Error('should not run'));
    const fetcher = new ContentFetcher({ strategies: [first, fallback] });
    const controller = new AbortController();
    controller.abort(abortError);

    await expect(
      fetcher.fetch('https://example.com/article', controller.signal),
    ).rejects.toThrow('aborted');
    expect(fallback.fetch).not.toHaveBeenCalled();
  });

  it('should throw last error when all strategies fail', async () => {
    const strategies = [
      mockStrategy('tier0', new Error('Error from T0')),
      mockStrategy('tier1', new Error('Error from T1')),
    ];

    const fetcher = new ContentFetcher({ strategies });
    await expect(
      fetcher.fetch('https://example.com/article'),
    ).rejects.toThrow('Error from T1');
  });

  it('should skip unavailable strategies', async () => {
    const successResult: FetchResult = {
      url: 'https://example.com/article',
      statusCode: 200,
      headers: {},
      body: htmlBody,
    };

    const strategies = [
      mockStrategyUnavailable('unavailable'),
      mockStrategy('available', successResult),
    ];

    const fetcher = new ContentFetcher({ strategies });
    const result = await fetcher.fetch('https://example.com/article');

    expect(result).toBe(successResult);
    expect((strategies[0].fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((strategies[1].fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('should throw generic error when no strategies are available', async () => {
    const strategies = [
      mockStrategyUnavailable('tier0'),
      mockStrategyUnavailable('tier1'),
    ];

    const fetcher = new ContentFetcher({ strategies });
    await expect(
      fetcher.fetch('https://example.com/article'),
    ).rejects.toThrow('All fetch strategies failed');
  });

  it('should propagate AbortSignal to all strategies', async () => {
    const controller = new AbortController();

    const strategies = [
      mockStrategy('tier0', new Error('Tier 0 failed')),
      mockStrategy('tier1', new Error('Tier 1 failed')),
    ];

    const fetcher = new ContentFetcher({ strategies });

    await expect(
      fetcher.fetch('https://example.com/article', controller.signal),
    ).rejects.toThrow('Tier 1 failed');

    // Verify signal was passed to each strategy
    for (const s of strategies) {
      expect((s.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        'https://example.com/article',
        controller.signal,
      );
    }
  });
});
