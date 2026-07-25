import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../../../src/main/ai/provider/OpenAICompatibleProvider';

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

  it('reports response-header and first-delta timing phases once', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"First"}}]}\n\n',
      { status: 200 },
    )));
    const onTiming = vi.fn();
    const provider = new OpenAICompatibleProvider();

    for await (const chunk of provider.stream({ ...request(), onTiming })) void chunk;

    expect(onTiming.mock.calls).toEqual([
      ['response-headers'],
      ['first-delta'],
    ]);
  });

  it('requests usage metadata and forwards only token values returned by the Provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"content":"Translated"}}]}\n',
      'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n',
      'data: [DONE]\n',
    ].join(''), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const onUsage = vi.fn();
    const provider = new OpenAICompatibleProvider();

    for await (const chunk of provider.stream({ ...request(), requestUsage: true, onUsage })) {
      void chunk;
    }

    const requestBody = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(requestBody.stream_options).toEqual({ include_usage: true });
    expect(onUsage).toHaveBeenCalledOnce();
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 11, outputTokens: 7 });
    expect(onUsage.mock.calls[0]?.[0]).not.toHaveProperty('totalTokens');
  });

  it('normalizes input/output usage names and prioritizes prompt/completion when both exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response([
      'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7,"input_tokens":111,"output_tokens":77,"total_tokens":18}}\n',
      'data: [DONE]\n',
    ].join(''), { status: 200 })));
    const onUsage = vi.fn();
    const provider = new OpenAICompatibleProvider();

    for await (const chunk of provider.stream({ ...request(), requestUsage: true, onUsage })) {
      void chunk;
    }

    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
    });
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
