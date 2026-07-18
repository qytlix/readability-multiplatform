import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../../src/main/ai/provider/OpenAICompatibleProvider';

afterEach(() => {
  vi.unstubAllGlobals();
});

const request = () => ({
  baseUrl: 'https://provider.example/v1',
  model: 'test-model',
  apiKey: 'test-key',
  prompt: 'Summarize this.',
  signal: new AbortController().signal,
});

describe('OpenAICompatibleProvider', () => {
  it('parses ordered OpenAI-compatible SSE text chunks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"content":"First "}}]}\n',
      'data: {"choices":[{"delta":{"content":"second."}}]}\n',
      'data: [DONE]\n',
    ].join(''), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatibleProvider();
    const chunks: string[] = [];
    for await (const chunk of provider.stream(request())) chunks.push(chunk);

    expect(chunks).toEqual(['First ', 'second.']);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://provider.example/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer test-key' }),
      }),
    );
  });

  it('maps authentication responses to a stable safe error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    const provider = new OpenAICompatibleProvider();

    await expect((async () => {
      for await (const chunk of provider.stream(request())) {
        // The authentication failure occurs before any chunk is emitted.
        void chunk;
      }
    })()).rejects.toMatchObject({
      code: 'SUMMARY_PROVIDER_AUTH',
      retryable: false,
    });
  });
});
