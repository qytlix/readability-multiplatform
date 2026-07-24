import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../../../src/main/ai/provider/AnthropicProvider';

afterEach(() => {
  vi.unstubAllGlobals();
});

const request = () => ({
  providerKind: 'anthropic' as const,
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-5',
  apiKey: 'anthropic-test-key',
  prompt: 'Summarize this.',
  signal: new AbortController().signal,
});

describe('AnthropicProvider', () => {
  it('uses the native Messages request and parses text_delta SSE events', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      'event: message_start\n',
      'data: {"type":"message_start"}\n\n',
      'event: ping\n',
      'data: {"type":"ping"}\n\n',
      'event: content_block_delta\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Native "}}\n\n',
      'event: content_block_delta\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Claude."}}\n\n',
      'event: message_stop\n',
      'data: {"type":"message_stop"}\n\n',
    ].join(''), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new AnthropicProvider();
    const chunks: string[] = [];

    for await (const chunk of provider.stream(request())) chunks.push(chunk);

    expect(chunks).toEqual(['Native ', 'Claude.']);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'anthropic-test-key',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'claude-sonnet-4-5',
      stream: true,
      messages: [{ role: 'user', content: 'Summarize this.' }],
    });
  });

  it('handles an event split across transport chunks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamingResponse([
      'event: content_block_delta\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_',
      'delta","text":"split"}}\n\n',
    ])));
    const chunks: string[] = [];

    for await (const chunk of new AnthropicProvider().stream(request())) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['split']);
  });

  it('maps overloaded stream errors to a retryable stable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response([
      'event: error\n',
      'data: {"type":"error","error":{"type":"overloaded_error"}}\n\n',
    ].join(''), { status: 200 })));

    await expect(collect(new AnthropicProvider())).rejects.toMatchObject({
      code: 'SUMMARY_PROVIDER_REQUEST_FAILED',
      retryable: true,
    });
  });

  it('tests the configured model with a minimal native Messages request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      '{"content":[{"type":"text","text":"OK"}]}',
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await new AnthropicProvider().testConnection({
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5',
      apiKey: 'anthropic-test-key',
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.any(Object),
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'claude-sonnet-4-5',
      max_tokens: 1,
    });
  });
});

async function collect(provider: AnthropicProvider): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of provider.stream(request())) chunks.push(chunk);
  return chunks;
}

function streamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }), { status: 200 });
}
