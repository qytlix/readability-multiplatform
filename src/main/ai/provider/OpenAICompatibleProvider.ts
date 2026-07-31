import {
  normalizeProviderFinishReason,
  validateProviderConversation,
  type ProviderContentPart,
  type ProviderMessage,
  type ProviderTokenUsage,
  type TextGenerationConnectionRequest,
  type TextGenerationImageConnectionRequest,
  type TextGenerationProvider,
  type TextGenerationProviderRequest,
} from './TextGenerationProvider';
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
    const messages = buildOpenAIMessages(request);
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
            messages,
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

  async testImageConnection(
    request: TextGenerationImageConnectionRequest,
  ): Promise<void> {
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
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: 'Reply with OK if you can inspect this image.' },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${request.mimeType};base64,${Buffer.from(request.bytes).toString('base64')}`,
                  },
                },
              ],
            }],
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

function buildOpenAIMessages(
  request: TextGenerationProviderRequest,
): Array<Record<string, unknown>> {
  const conversation = validateProviderConversation(request);
  if (request.messages === undefined) {
    return [{
      role: 'user',
      content: conversation.messages[0]?.content[0]?.type === 'text'
        ? conversation.messages[0].content[0].text
        : '',
    }];
  }
  return [
    ...(conversation.systemInstruction
      ? [{ role: 'system', content: conversation.systemInstruction }]
      : []),
    ...conversation.messages.map(mapOpenAIMessage),
  ];
}

function mapOpenAIMessage(message: ProviderMessage): Record<string, unknown> {
  return {
    role: message.role,
    content: message.content.map(mapOpenAIContentPart),
  };
}

function mapOpenAIContentPart(part: ProviderContentPart): Record<string, unknown> {
  if (part.type === 'text') return { type: 'text', text: part.text };
  return {
    type: 'image_url',
    image_url: {
      url: `data:${part.mimeType};base64,${Buffer.from(part.bytes).toString('base64')}`,
    },
  };
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
      isRecord(firstChoice.error)
        ? isRetryableOpenAIError(firstChoice.error)
        : true,
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
  const metadata = isRecord(error.metadata) ? error.metadata : {};
  const markers = [
    error.code,
    error.type,
    error.status,
    metadata.error_type,
  ].filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase());
  if (markers.some((marker) => [
    'invalid_request_error',
    'authentication_error',
    'permission_error',
    'insufficient_quota',
    'context_length_exceeded',
    'model_not_found',
    'content_policy_violation',
  ].includes(marker))) {
    return false;
  }

  const statusCode = parseProviderStatusCode(error.code)
    ?? parseProviderStatusCode(error.status)
    ?? parseProviderStatusCode(error.status_code);
  if (statusCode !== undefined) {
    return statusCode === 408 || statusCode === 429 || statusCode >= 500;
  }

  if (markers.some((marker) => [
    'rate_limit_exceeded',
    'provider_unavailable',
    'server_error',
    'overloaded_error',
    'upstream_error',
    'bad_response_status_code',
    'timeout',
  ].includes(marker))) {
    return true;
  }

  const message = typeof error.message === 'string'
    ? error.message.toLowerCase()
    : '';
  if (
    /rate.?limit|too many requests|timeout|timed out|overload|unavailable|upstream|server error|internal error|status (?:code )?5\d\d/.test(message)
  ) {
    return true;
  }
  if (
    /invalid request|context length|maximum context|authentication|api.?key|permission|quota|billing|model not found|content policy/.test(message)
  ) {
    return false;
  }

  // A Provider that accepted the HTTP request but then emitted an opaque SSE
  // error may have failed in its upstream generation path. Article Chat applies
  // only one retry, and only before any answer text has been emitted.
  return true;
}

function parseProviderStatusCode(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value !== 'string' || !/^\d{3}$/.test(value.trim())) {
    return undefined;
  }
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
