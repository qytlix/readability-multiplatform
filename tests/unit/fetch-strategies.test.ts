import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SimpleFetchStrategy,
  EnhancedFetchStrategy,
  BrowserFetchStrategy,
} from '../../src/main/feed/FetchStrategy';

// ── Mock helpers ────────────────────────────────────────────────

function setMockFetch(fn: (...args: any[]) => any): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = fn;
}

function makeStreamBody(body: string): {
  getReader: () => { read: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
} {
  const encoder = new TextEncoder();
  const data = encoder.encode(body);
  return {
    getReader: () => ({
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: data })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      cancel: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

function mockOkResponse(
  body: string,
  opts?: {
    charset?: string;
    finalUrl?: string;
    extraHeaders?: Record<string, string>;
  },
) {
  return (_url: string, init?: { signal?: AbortSignal }) => {
    if (init?.signal?.aborted) {
      return Promise.reject(new DOMException('The operation was aborted', 'AbortError'));
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: opts?.finalUrl ?? 'https://example.com/article',
      headers: {
        get: (name: string) => {
          if (name === 'content-type' && opts?.charset) return opts.charset;
          if (opts?.extraHeaders?.[name]) return opts.extraHeaders[name];
          return null;
        },
        entries: () => [],
      },
      body: makeStreamBody(body),
    });
  };
}

function mockErrorResponse(
  status: number,
  statusText: string,
): (...args: any[]) => Promise<any> {
  return (_url: string, init?: { signal?: AbortSignal }) => {
    if (init?.signal?.aborted) {
      return Promise.reject(new DOMException('The operation was aborted', 'AbortError'));
    }
    return Promise.resolve({
      ok: false,
      status,
      statusText,
      headers: { get: () => null, entries: () => [] },
      body: makeStreamBody(''),
    });
  };
}

// ── SimpleFetchStrategy ─────────────────────────────────────────

describe('SimpleFetchStrategy', () => {
  const htmlBody = '<html><body><article>Test Content</article></body></html>';
  let strategy: SimpleFetchStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new SimpleFetchStrategy();
  });

  it('should fetch and return article HTML', async () => {
    setMockFetch(mockOkResponse(htmlBody, { charset: 'text/html; charset=utf-8' }));
    const result = await strategy.fetch('https://example.com/article');

    expect(result.body).toBe(htmlBody);
    expect(result.statusCode).toBe(200);
    expect(result.charset).toBe('utf-8');
  });

  it('should extract charset from content-type', async () => {
    setMockFetch(mockOkResponse(htmlBody, { charset: 'text/html; charset=gb2312' }));
    const result = await strategy.fetch('https://example.com/article');
    expect(result.charset).toBe('gb2312');
  });

  it('should throw on 403 response', async () => {
    setMockFetch(mockErrorResponse(403, 'Forbidden'));
    await expect(
      strategy.fetch('https://example.com/protected'),
    ).rejects.toThrow('HTTP 403: Forbidden');
  });

  it('should throw on 404 response', async () => {
    setMockFetch(mockErrorResponse(404, 'Not Found'));
    await expect(
      strategy.fetch('https://example.com/404'),
    ).rejects.toThrow('HTTP 404');
  });

  it('should always be available', () => {
    expect(strategy.isAvailable()).toBe(true);
  });

  it('should set Shale/1.0 user-agent', async () => {
    let capturedInit: any = null;
    setMockFetch((url: string, init?: any) => {
      capturedInit = init;
      return mockOkResponse(htmlBody)(url, init);
    });

    await strategy.fetch('https://example.com/article');
    expect(capturedInit.headers['User-Agent']).toBe('Shale/1.0 Feed Reader');
  });

  it('should be named "simple"', () => {
    expect(strategy.name).toBe('simple');
  });
});

// ── EnhancedFetchStrategy ───────────────────────────────────────

describe('EnhancedFetchStrategy', () => {
  const htmlBody = '<html><body><article>Enhanced Content</article></body></html>';
  let strategy: EnhancedFetchStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new EnhancedFetchStrategy();
  });

  it('should fetch successfully with browser-like headers', async () => {
    let capturedInit: any = null;
    setMockFetch((url: string, init?: any) => {
      capturedInit = init;
      return mockOkResponse(htmlBody)(url, init);
    });

    const result = await strategy.fetch('https://example.com/article');

    expect(result.body).toBe(htmlBody);
    expect(result.statusCode).toBe(200);

    // Verify enhanced headers
    expect(capturedInit.headers['User-Agent']).toMatch(/Mozilla\/5\.0/);
    expect(capturedInit.headers['Accept-Language']).toBe('zh-CN,zh;q=0.9,en;q=0.8');
    expect(capturedInit.headers['Sec-Fetch-Dest']).toBe('document');
    expect(capturedInit.headers['Referer']).toBe('https://example.com');
  });

  it('should retry on 403 with different UA, then succeed', async () => {
    let callCount = 0;
    const capturedUAs: string[] = [];
    setMockFetch((url: string, init?: any) => {
      callCount++;
      capturedUAs.push(init?.headers?.['User-Agent'] ?? '');
      if (callCount <= 2) return mockErrorResponse(403, 'Forbidden')(url, init);
      return mockOkResponse(htmlBody)(url, init);
    });

    const result = await strategy.fetch('https://example.com/protected');
    expect(result.body).toBe(htmlBody);
    expect(callCount).toBe(3);
    // UA should have rotated
    expect(capturedUAs[0]).not.toBe(capturedUAs[1]);
  });

  it('should eventually throw after all retries exhausted on 403', async () => {
    setMockFetch(mockErrorResponse(403, 'Forbidden'));

    const s = new EnhancedFetchStrategy({ maxRetries: 2 });
    await expect(
      s.fetch('https://example.com/protected'),
    ).rejects.toThrow('HTTP 403: Forbidden');
  });

  it('should not retry on 404 (non-retryable)', async () => {
    let callCount = 0;
    setMockFetch(() => {
      callCount++;
      return mockErrorResponse(404, 'Not Found')();
    });

    await expect(
      strategy.fetch('https://example.com/not-found'),
    ).rejects.toThrow('HTTP 404');
    expect(callCount).toBe(1); // No retry
  });

  it('should not retry on AbortError', async () => {
    let callCount = 0;
    setMockFetch((_url: string, init?: { signal?: AbortSignal }) => {
      callCount++;
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException('aborted', 'AbortError'));
      }
      return mockErrorResponse(403, 'Forbidden')(_url, init);
    });

    const controller = new AbortController();
    controller.abort(new DOMException('Aborted', 'AbortError'));

    await expect(
      strategy.fetch('https://example.com/article', controller.signal),
    ).rejects.toThrow();
    expect(callCount).toBeLessThanOrEqual(1); // AbortError should stop immediately
  });

  it('should always be available', () => {
    expect(strategy.isAvailable()).toBe(true);
  });

  it('should be named "enhanced"', () => {
    expect(strategy.name).toBe('enhanced');
  });
});

// ── BrowserFetchStrategy ────────────────────────────────────────

describe('BrowserFetchStrategy', () => {
  let strategy: BrowserFetchStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new BrowserFetchStrategy();
  });

  it('should be unavailable outside Electron Main process', () => {
    // In test environment (Node.js), process.type is undefined
    expect(strategy.isAvailable()).toBe(false);
  });

  it('should throw when called in non-Electron environment', async () => {
    await expect(
      strategy.fetch('https://example.com/article'),
    ).rejects.toThrow('not available');
  });

  it('should be named "browser"', () => {
    expect(strategy.name).toBe('browser');
  });
});