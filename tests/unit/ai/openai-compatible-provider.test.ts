import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../../../src/main/ai/provider/OpenAICompatibleProvider';

afterEach(() => {
  vi.unstubAllGlobals();
});

const request = () => ({
  providerKind: 'openai' as const,
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

  it('handles split SSE chunks and ignores keepalive comments', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamingResponse([
      ': OPENROUTER PROCESSING\n',
      'data: {"choices":[{"delta":{"content":"split',
      ' chunk"}}]}\n\n',
      'data: [DONE]\n\n',
    ])));
    const provider = new OpenAICompatibleProvider();
    const chunks: string[] = [];

    for await (const chunk of provider.stream(request())) chunks.push(chunk);

    expect(chunks).toEqual(['split chunk']);
  });

  it('surfaces OpenRouter-compatible errors that arrive after partial content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
      'data: {"error":{"code":429,"metadata":{"error_type":"rate_limit_exceeded"}},"choices":[]}\n\n',
    ].join(''), { status: 200 })));
    const provider = new OpenAICompatibleProvider();
    const chunks: string[] = [];

    await expect((async () => {
      for await (const chunk of provider.stream({
        ...request(),
        providerKind: 'openrouter',
      })) {
        chunks.push(chunk);
      }
    })()).rejects.toMatchObject({
      code: 'SUMMARY_PROVIDER_REQUEST_FAILED',
      retryable: true,
    });
    expect(chunks).toEqual(['partial']);
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

  it('tests the configured model with a minimal non-streaming request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      '{"choices":[{"message":{"content":"OK"}}]}',
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await new OpenAICompatibleProvider().testConnection({
      baseUrl: 'https://provider.example/v1',
      model: 'test-model',
      apiKey: 'test-key',
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(fetchMock).toHaveBeenCalledWith(
      'https://provider.example/v1/chat/completions',
      expect.any(Object),
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'test-model',
      stream: false,
      max_tokens: 1,
    });
  });
});

function streamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }), { status: 200 });
}
