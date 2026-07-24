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

/** OpenAI Chat Completions adapter shared by OpenAI, DeepSeek, and OpenRouter. */
export class OpenAICompatibleProvider implements TextGenerationProvider {
  async *stream(request: TextGenerationProviderRequest): AsyncIterable<string> {
    const scope = createProviderAbortScope(request.signal);
    let receivedFirstDelta = false;
    try {
      const response = await fetchProviderResponse(
        buildCompletionUrl(request.baseUrl),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${request.apiKey}`,
          },
          body: JSON.stringify({
            model: request.model,
            stream: true,
            messages: [{ role: 'user', content: request.prompt }],
          }),
        },
        scope,
      );
      request.onTiming?.('response-headers');

      for await (const event of readServerSentEvents(response, scope)) {
        if (!event.data || event.data === '[DONE]') continue;
        const delta = parseOpenAIStreamEvent(event.data);
        if (!delta) continue;
        if (!receivedFirstDelta) {
          receivedFirstDelta = true;
          request.onTiming?.('first-delta');
        }
        yield delta;
      }
    } finally {
      scope.dispose();
    }
  }

  async testConnection(request: TextGenerationConnectionRequest): Promise<void> {
    const scope = createProviderAbortScope();
    try {
      const response = await fetchProviderResponse(
        buildCompletionUrl(request.baseUrl),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${request.apiKey}`,
          },
          body: JSON.stringify({
            model: request.model,
            stream: false,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'Reply with OK.' }],
          }),
        },
        scope,
      );
      await response.body?.cancel();
    } finally {
      scope.dispose();
    }
  }
}

function buildCompletionUrl(baseUrl: string): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL('chat/completions', normalized).toString();
}

function parseOpenAIStreamEvent(payload: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw providerProtocolError('The provider returned malformed streaming JSON.');
  }
  if (!isRecord(parsed)) {
    throw providerProtocolError('The provider returned an invalid streaming event.');
  }

  if (isRecord(parsed.error)) {
    throw providerStreamError(isRetryableOpenAIError(parsed.error));
  }

  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const firstChoice = choices[0];
  if (!isRecord(firstChoice)) return undefined;
  if (isRecord(firstChoice.error) || firstChoice.finish_reason === 'error') {
    throw providerStreamError(
      isRecord(firstChoice.error) && isRetryableOpenAIError(firstChoice.error),
    );
  }
  if (!isRecord(firstChoice.delta)) return undefined;
  return typeof firstChoice.delta.content === 'string'
    ? firstChoice.delta.content
    : undefined;
}

function isRetryableOpenAIError(error: Record<string, unknown>): boolean {
  const code = error.code;
  if (typeof code === 'number') return code === 408 || code === 429 || code >= 500;
  if (typeof code === 'string') {
    return [
      '408',
      '429',
      'rate_limit_exceeded',
      'provider_unavailable',
      'server_error',
      'overloaded_error',
    ].includes(code);
  }
  const metadata = error.metadata;
  if (!isRecord(metadata) || typeof metadata.error_type !== 'string') return false;
  return [
    'rate_limit_exceeded',
    'provider_unavailable',
    'server_error',
    'overloaded_error',
  ].includes(metadata.error_type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
