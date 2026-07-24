import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProviderAbortScope,
  fetchProviderResponse,
} from '../../../src/main/ai/provider/ProviderTransport';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ProviderTransport', () => {
  it('maps caller cancellation to the stable interrupted error', async () => {
    const caller = new AbortController();
    const scope = createProviderAbortScope(caller.signal);
    vi.stubGlobal('fetch', abortableFetch());

    const pending = fetchProviderResponse('https://provider.example', {}, scope);
    const expectation = expect(pending).rejects.toMatchObject({
      code: 'SUMMARY_INTERRUPTED',
      retryable: true,
    });
    caller.abort();

    await expectation;
    scope.dispose();
  });

  it('maps the 60-second request deadline to the stable timeout error', async () => {
    vi.useFakeTimers();
    const scope = createProviderAbortScope();
    vi.stubGlobal('fetch', abortableFetch());

    const pending = fetchProviderResponse('https://provider.example', {}, scope);
    const expectation = expect(pending).rejects.toMatchObject({
      code: 'SUMMARY_PROVIDER_TIMEOUT',
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(60_000);

    await expectation;
    scope.dispose();
  });
});

function abortableFetch(): typeof fetch {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal?.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    })) as typeof fetch;
}
