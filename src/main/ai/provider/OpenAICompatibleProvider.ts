import type {
  ProviderTokenUsage,
  TextGenerationConnectionRequest,
  TextGenerationProvider,
  TextGenerationProviderRequest,
} from './TextGenerationProvider';
import { normalizeProviderFinishReason } from './TextGenerationProvider';
import { normalizeProviderTokenUsage } from './ProviderTokenUsage';
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
    let latestUsage: ProviderTokenUsage | undefined;
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
            ...(request.requestUsage ? { stream_options: { include_usage: true } } : {}),
            messages: [{ role: 'user', content: request.prompt }],
          }),
        },
        scope,
      );
      request.onTiming?.('response-headers');

      for await (const event of readServerSentEvents(response, scope)) {
        if (!event.data || event.data === '[DONE]') continue;
        const parsedEvent = parseOpenAIStreamEvent(event.data);
        if (parsedEvent?.usage) latestUsage = parsedEvent.usage;
        if (parsedEvent?.finishReason) request.onFinishReason?.(parsedEvent.finishReason);
        if (!parsedEvent?.delta) continue;
        if (!receivedFirstDelta) {
          receivedFirstDelta = true;
          request.onTiming?.('first-delta');
        }
        scope.recordResponseActivity();
        yield parsedEvent.delta;
      }
    } finally {
      try {
        if (latestUsage) request.onUsage?.(latestUsage);
      } catch {
        // Usage callbacks are diagnostic-only and must not change request behavior.
      }
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

function parseOpenAIStreamEvent(
  payload: string,
): {
  delta?: string;
  usage?: ProviderTokenUsage;
  finishReason?: ReturnType<typeof normalizeProviderFinishReason>;
} | undefined {
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

  const usage = normalizeProviderTokenUsage(parsed.usage);
  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return usage ? { usage } : undefined;
  }
  const firstChoice = choices[0];
  if (!isRecord(firstChoice)) return usage ? { usage } : undefined;
  if (isRecord(firstChoice.error) || firstChoice.finish_reason === 'error') {
    throw providerStreamError(
      isRecord(firstChoice.error) && isRetryableOpenAIError(firstChoice.error),
    );
  }
  const finishReason = normalizeProviderFinishReason(firstChoice.finish_reason);
  const delta = isRecord(firstChoice.delta) && typeof firstChoice.delta.content === 'string'
    ? firstChoice.delta.content
    : undefined;
  return delta || usage || finishReason
    ? {
        ...(delta ? { delta } : {}),
        ...(usage ? { usage } : {}),
        ...(finishReason ? { finishReason } : {}),
      }
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
