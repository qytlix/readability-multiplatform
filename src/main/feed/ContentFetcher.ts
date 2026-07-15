import type { FetchResult } from '../../shared/contracts/content.types';

export class ContentFetcher {
  private maxSize: number;
  private timeoutMs: number;

  constructor(options?: { maxSize?: number; timeoutMs?: number }) {
    this.maxSize = options?.maxSize ?? 10 * 1024 * 1024; // 10MB
    this.timeoutMs = options?.timeoutMs ?? 30_000;
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const controller = new AbortController();
    const combinedSignal = signal
      ? combineSignals(signal, controller.signal)
      : controller.signal;

    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        signal: combinedSignal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Shale/1.0 Feed Reader',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const finalUrl = response.url;
      const contentType = response.headers.get('content-type') ?? '';
      const charset = extractCharset(contentType);

      // Read body with size limit
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
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
          throw new Error(`Response too large (exceeded ${this.maxSize} bytes)`);
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
    } finally {
      clearTimeout(timeout);
    }
  }
}

function extractCharset(contentType: string): string | null {
  const match = contentType.match(/charset\s*=\s*([^\s;]+)/i);
  return match ? match[1].toLowerCase() : null;
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function combineSignals(
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