import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContentFetcher } from '../../src/main/feed/ContentFetcher';

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
    ).rejects.toThrow('aborted');
  }, 10_000);
});
