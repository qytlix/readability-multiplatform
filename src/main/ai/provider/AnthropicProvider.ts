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

const ANTHROPIC_VERSION = '2023-06-01';

/** Native Anthropic Messages adapter. */
export class AnthropicProvider implements TextGenerationProvider {
  async *stream(request: TextGenerationProviderRequest): AsyncIterable<string> {
    const scope = createProviderAbortScope(request.signal);
    let receivedFirstDelta = false;
    try {
      const response = await fetchProviderResponse(
        buildMessagesUrl(request.baseUrl),
        {
          method: 'POST',
          headers: buildHeaders(request.apiKey),
          body: JSON.stringify({
            model: request.model,
            max_tokens: 4_096,
            stream: true,
            messages: [{ role: 'user', content: request.prompt }],
          }),
        },
        scope,
      );
      request.onTiming?.('response-headers');

      for await (const event of readServerSentEvents(response, scope)) {
        if (!event.data) continue;
        const delta = parseAnthropicStreamEvent(event.event, event.data);
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
        buildMessagesUrl(request.baseUrl),
        {
          method: 'POST',
          headers: buildHeaders(request.apiKey),
          body: JSON.stringify({
            model: request.model,
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

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
  };
}

function buildMessagesUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/v1/messages')) return url.toString();
  url.pathname = path.endsWith('/v1')
    ? `${path}/messages`
    : `${path}/v1/messages`;
  return url.toString();
}

function parseAnthropicStreamEvent(
  eventName: string | undefined,
  payload: string,
): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw providerProtocolError('Anthropic returned malformed streaming JSON.');
  }
  if (!isRecord(parsed)) {
    throw providerProtocolError('Anthropic returned an invalid streaming event.');
  }

  const type = typeof parsed.type === 'string' ? parsed.type : eventName;
  if (type === 'error') {
    const error = isRecord(parsed.error) ? parsed.error : {};
    throw providerStreamError(isRetryableAnthropicError(error));
  }
  if (type !== 'content_block_delta' || !isRecord(parsed.delta)) return undefined;
  if (parsed.delta.type !== 'text_delta') return undefined;
  return typeof parsed.delta.text === 'string' ? parsed.delta.text : undefined;
}

function isRetryableAnthropicError(error: Record<string, unknown>): boolean {
  return typeof error.type === 'string'
    && ['overloaded_error', 'rate_limit_error', 'api_error'].includes(error.type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

