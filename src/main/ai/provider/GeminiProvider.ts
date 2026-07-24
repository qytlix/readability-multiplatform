import type {
  TextGenerationConnectionRequest,
  TextGenerationProvider,
  TextGenerationProviderRequest,
} from './TextGenerationProvider';
import {
  createProviderAbortScope,
  fetchProviderResponse,
  providerProtocolError,
  providerStreamError,
  readServerSentEvents,
} from './ProviderTransport';

/** Native Gemini GenerateContent adapter. */
export class GeminiProvider implements TextGenerationProvider {
  async *stream(request: TextGenerationProviderRequest): AsyncIterable<string> {
    const scope = createProviderAbortScope(request.signal);
    let receivedFirstDelta = false;
    try {
      const response = await fetchProviderResponse(
        buildGenerateContentUrl(
          request.baseUrl,
          request.model,
          'streamGenerateContent',
          true,
        ),
        {
          method: 'POST',
          headers: buildHeaders(request.apiKey),
          body: JSON.stringify(buildBody(request.prompt, 4_096)),
        },
        scope,
      );
      request.onTiming?.('response-headers');

      for await (const event of readServerSentEvents(response, scope)) {
        if (!event.data || event.data === '[DONE]') continue;
        const deltas = parseGeminiStreamEvent(event.data);
        for (const delta of deltas) {
          if (!receivedFirstDelta) {
            receivedFirstDelta = true;
            request.onTiming?.('first-delta');
          }
          yield delta;
        }
      }
    } finally {
      scope.dispose();
    }
  }

  async testConnection(request: TextGenerationConnectionRequest): Promise<void> {
    const scope = createProviderAbortScope();
    try {
      const response = await fetchProviderResponse(
        buildGenerateContentUrl(
          request.baseUrl,
          request.model,
          'generateContent',
          false,
        ),
        {
          method: 'POST',
          headers: buildHeaders(request.apiKey),
          body: JSON.stringify(buildBody('Reply with OK.', 1)),
        },
        scope,
      );
      await response.body?.cancel();
    } finally {
      scope.dispose();
    }
  }
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-goog-api-key': apiKey,
  };
}

function buildBody(prompt: string, maxOutputTokens: number): Record<string, unknown> {
  return {
    contents: [{
      role: 'user',
      parts: [{ text: prompt }],
    }],
    generationConfig: { maxOutputTokens },
  };
}

function buildGenerateContentUrl(
  baseUrl: string,
  model: string,
  method: 'generateContent' | 'streamGenerateContent',
  streaming: boolean,
): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, '');
  const modelsPath = path.endsWith('/models')
    ? path
    : path.endsWith('/v1') || path.endsWith('/v1beta')
      ? `${path}/models`
      : `${path}/v1beta/models`;
  const normalizedModel = model.replace(/^models\//, '');
  url.pathname = `${modelsPath}/${normalizedModel}:${method}`;
  if (streaming) url.searchParams.set('alt', 'sse');
  return url.toString();
}

function parseGeminiStreamEvent(payload: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw providerProtocolError('Gemini returned malformed streaming JSON.');
  }
  if (!isRecord(parsed)) {
    throw providerProtocolError('Gemini returned an invalid streaming event.');
  }
  if (isRecord(parsed.error)) {
    throw providerStreamError(isRetryableGeminiError(parsed.error));
  }
  if (
    isRecord(parsed.promptFeedback)
    && typeof parsed.promptFeedback.blockReason === 'string'
  ) {
    throw providerStreamError(false);
  }

  const candidates = parsed.candidates;
  if (!Array.isArray(candidates) || !isRecord(candidates[0])) return [];
  const content = candidates[0].content;
  if (!isRecord(content) || !Array.isArray(content.parts)) return [];
  return content.parts.flatMap((part) =>
    isRecord(part) && typeof part.text === 'string' ? [part.text] : []);
}

function isRetryableGeminiError(error: Record<string, unknown>): boolean {
  const code = error.code;
  if (typeof code === 'number') return code === 408 || code === 429 || code >= 500;
  const status = error.status;
  return typeof status === 'string'
    && ['RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'DEADLINE_EXCEEDED', 'INTERNAL'].includes(status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

