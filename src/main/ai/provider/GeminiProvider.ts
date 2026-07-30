import type {
  TextGenerationConnectionRequest,
  TextGenerationImageConnectionRequest,
  TextGenerationProvider,
  TextGenerationProviderRequest,
} from './TextGenerationProvider';
import { normalizeProviderFinishReason } from './TextGenerationProvider';
import {
  validateProviderConversation,
  type ProviderContentPart,
  type ProviderMessage,
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
          body: JSON.stringify(buildBody(request, 4_096)),
        },
        scope,
      );
      request.onTiming?.('response-headers');

      for await (const event of readServerSentEvents(response, scope)) {
        if (!event.data || event.data === '[DONE]') continue;
        const parsedEvent = parseGeminiStreamEvent(event.data);
        if (parsedEvent.finishReason) request.onFinishReason?.(parsedEvent.finishReason);
        for (const delta of parsedEvent.deltas) {
          if (!receivedFirstDelta) {
            receivedFirstDelta = true;
            request.onTiming?.('first-delta');
          }
          scope.recordResponseActivity();
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
          body: JSON.stringify(buildBody({ prompt: 'Reply with OK.' }, 1)),
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
        buildGenerateContentUrl(
          request.baseUrl,
          request.model,
          'generateContent',
          false,
        ),
        {
          method: 'POST',
          headers: buildHeaders(request.apiKey),
          body: JSON.stringify(buildBody({
            prompt: '',
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'image',
                  mimeType: request.mimeType,
                  bytes: request.bytes,
                },
                { type: 'text', text: 'Reply with OK if you can inspect this image.' },
              ],
            }],
          }, 1)),
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

function buildBody(
  request: Pick<
    TextGenerationProviderRequest,
    'prompt' | 'systemInstruction' | 'messages'
  >,
  maxOutputTokens: number,
): Record<string, unknown> {
  const conversation = validateProviderConversation(request);
  return {
    ...(conversation.systemInstruction
      ? { systemInstruction: { parts: [{ text: conversation.systemInstruction }] } }
      : {}),
    contents: conversation.messages.map(mapGeminiMessage),
    generationConfig: { maxOutputTokens },
  };
}

function mapGeminiMessage(message: ProviderMessage): Record<string, unknown> {
  return {
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: message.content.map(mapGeminiContentPart),
  };
}

function mapGeminiContentPart(part: ProviderContentPart): Record<string, unknown> {
  if (part.type === 'text') return { text: part.text };
  return {
    inlineData: {
      mimeType: part.mimeType,
      data: Buffer.from(part.bytes).toString('base64'),
    },
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

function parseGeminiStreamEvent(payload: string): {
  deltas: string[];
  finishReason?: ReturnType<typeof normalizeProviderFinishReason>;
} {
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
  if (!Array.isArray(candidates) || !isRecord(candidates[0])) return { deltas: [] };
  const finishReason = normalizeProviderFinishReason(candidates[0].finishReason);
  const content = candidates[0].content;
  if (!isRecord(content) || !Array.isArray(content.parts)) {
    return finishReason ? { deltas: [], finishReason } : { deltas: [] };
  }
  const deltas = content.parts.flatMap((part) =>
    isRecord(part) && typeof part.text === 'string' ? [part.text] : []);
  return finishReason ? { deltas, finishReason } : { deltas };
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
