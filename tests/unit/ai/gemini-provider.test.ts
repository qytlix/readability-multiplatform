import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../../../src/main/ai/provider/GeminiProvider';

afterEach(() => {
  vi.unstubAllGlobals();
});

const request = () => ({
  providerKind: 'gemini' as const,
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  model: 'gemini-2.5-flash',
  apiKey: 'gemini-test-key',
  prompt: 'Translate this.',
  signal: new AbortController().signal,
});

describe('GeminiProvider', () => {
  it('uses streamGenerateContent and parses candidate part text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      'data: {"candidates":[{"content":{"parts":[{"text":"Gemini "}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"stream."}]}}]}\n\n',
    ].join(''), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new GeminiProvider();
    const chunks: string[] = [];

    for await (const chunk of provider.stream(request())) chunks.push(chunk);

    expect(chunks).toEqual(['Gemini ', 'stream.']);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-goog-api-key': 'gemini-test-key',
        }),
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      contents: [{
        role: 'user',
        parts: [{ text: 'Translate this.' }],
      }],
    });
  });

  it('handles split candidate events and ignores non-text parts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamingResponse([
      'data: {"candidates":[{"content":{"parts":[{"thought":true},',
      '{"text":"split"}]}}]}\n\n',
    ])));
    const chunks: string[] = [];

    for await (const chunk of new GeminiProvider().stream(request())) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['split']);
  });

  it('maps in-stream quota errors to retryable stable errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      'data: {"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}\n\n',
      { status: 200 },
    )));

    await expect(collect(new GeminiProvider())).rejects.toMatchObject({
      code: 'SUMMARY_PROVIDER_REQUEST_FAILED',
      retryable: true,
    });
  });

  it('tests the configured model with generateContent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      '{"candidates":[{"content":{"parts":[{"text":"OK"}]}}]}',
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await new GeminiProvider().testConnection({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-flash',
      apiKey: 'gemini-test-key',
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      expect.any(Object),
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      generationConfig: { maxOutputTokens: 1 },
    });
  });
});

async function collect(provider: GeminiProvider): Promise<string[]> {
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
