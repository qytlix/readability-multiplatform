import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../../../src/main/ai/provider/OpenAICompatibleProvider';

afterEach(() => {
  vi.useRealTimers();
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

  it('maps article chat system context and ordered messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      'data: [DONE]\n\n',
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    for await (const chunk of new OpenAICompatibleProvider().stream({
      ...request(),
      prompt: '',
      systemInstruction: 'Only answer from the article.',
      messages: [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Follow-up' },
      ],
    })) void chunk;

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body)).messages).toEqual([
      { role: 'system', content: 'Only answer from the article.' },
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Follow-up' },
    ]);
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

  it('keeps a stream alive beyond 60 seconds while translated text continues arriving', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(timedStreamingResponse([
        { afterMs: 50_000, text: 'First ' },
        { afterMs: 50_000, text: 'second ' },
        { afterMs: 50_000, text: 'third.' },
      ], init?.signal))));
    const provider = new OpenAICompatibleProvider();
    const chunks: string[] = [];

    const pending = (async () => {
      for await (const chunk of provider.stream(request())) chunks.push(chunk);
    })();
    await vi.advanceTimersByTimeAsync(150_001);
    await pending;

    expect(chunks).toEqual(['First ', 'second ', 'third.']);
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

  it('forwards a normalized Provider finish reason without exposing response content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"content":"Translated"},"finish_reason":"length"}]}\n',
      'data: [DONE]\n',
    ].join(''), { status: 200 })));
    const onFinishReason = vi.fn();
    const provider = new OpenAICompatibleProvider();

    for await (const chunk of provider.stream({ ...request(), onFinishReason })) void chunk;

    expect(onFinishReason).toHaveBeenCalledOnce();
    expect(onFinishReason).toHaveBeenCalledWith('length');
    expect(JSON.stringify(onFinishReason.mock.calls)).not.toContain('Translated');
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

function timedStreamingResponse(
  chunks: Array<{ afterMs: number; text: string }>,
  signal: AbortSignal | null | undefined,
): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      let elapsedMs = 0;
      let closed = false;
      const timers: Array<ReturnType<typeof setTimeout>> = [];
      chunks.forEach(({ afterMs, text }) => {
        elapsedMs += afterMs;
        timers.push(setTimeout(() => {
          if (closed) return;
          controller.enqueue(encoder.encode(
            `data: {"choices":[{"delta":{"content":${JSON.stringify(text)}}}]}\n\n`,
          ));
        }, elapsedMs));
      });
      timers.push(setTimeout(() => {
        if (closed) return;
        closed = true;
        controller.close();
      }, elapsedMs + 1));
      signal?.addEventListener('abort', () => {
        if (closed) return;
        closed = true;
        timers.forEach((timer) => clearTimeout(timer));
        controller.error(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    },
  }), { status: 200 });
}
