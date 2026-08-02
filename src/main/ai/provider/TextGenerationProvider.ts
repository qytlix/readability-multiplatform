import type { ProviderKind } from '../../../shared/contracts/provider.types';
import { CHAT_ERROR_CODES, ChatError } from '../../../shared/errors/chat.errors';

export type ProviderTimingPhase = 'response-headers' | 'first-delta';
export const PROVIDER_FINISH_REASONS = ['stop', 'length', 'content-filter', 'other'] as const;
export type ProviderFinishReason = (typeof PROVIDER_FINISH_REASONS)[number];

/** Token values explicitly returned by a Provider response. */
export interface ProviderTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type ProviderMessageRole = 'user' | 'assistant';

export type ProviderContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      mimeType: 'image/png' | 'image/jpeg';
      bytes: Uint8Array;
    };

export interface ProviderMessage {
  role: ProviderMessageRole;
  content: ProviderContentPart[];
}

export interface TextGenerationProviderRequest {
  providerKind?: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  /**
   * Legacy single-turn input retained for Summary, Translation, Tag, and
   * existing Provider test doubles. Chat sets this to an empty string and
   * supplies messages; an empty prompt is never serialized.
   */
  prompt: string;
  /** Chat-only system instruction. */
  systemInstruction?: string;
  /** Chat-only multi-turn text and image input. */
  messages?: ProviderMessage[];
  signal: AbortSignal;
  /** Requests usage metadata when the Provider supports it; response usage remains optional. */
  requestUsage?: boolean;
  onTiming?: (phase: ProviderTimingPhase) => void;
  onUsage?: (usage: ProviderTokenUsage) => void;
  /** A normalized completion reason when the selected provider exposes one. */
  onFinishReason?: (finishReason: ProviderFinishReason) => void;
}

export interface ValidatedProviderConversation {
  systemInstruction?: string;
  messages: ProviderMessage[];
}

const MAX_PROVIDER_IMAGE_BYTES = 5 * 1024 * 1024;

export function validateProviderConversation(
  request: Pick<
    TextGenerationProviderRequest,
    'prompt' | 'systemInstruction' | 'messages'
  >,
): ValidatedProviderConversation {
  const hasPrompt = Boolean(request.prompt.trim());
  const hasMessages = request.messages !== undefined;
  if (hasPrompt === hasMessages || (hasPrompt && request.systemInstruction !== undefined)) {
    throw invalidProviderInput(
      'Provide either a legacy prompt or Chat messages, but not both.',
    );
  }
  if (hasPrompt) {
    return {
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: request.prompt }],
      }],
    };
  }
  if (!request.messages?.length) {
    throw invalidProviderInput('At least one Chat message is required.');
  }
  for (const message of request.messages) {
    if (
      (message.role !== 'user' && message.role !== 'assistant')
      || !Array.isArray(message.content)
      || message.content.length === 0
    ) {
      throw invalidProviderInput('The Chat message structure is invalid.');
    }
    for (const part of message.content) {
      if (part.type === 'text') {
        if (typeof part.text !== 'string' || !part.text) {
          throw invalidProviderInput('Chat text content cannot be empty.');
        }
        continue;
      }
      if (
        part.type !== 'image'
        || (part.mimeType !== 'image/png' && part.mimeType !== 'image/jpeg')
        || !(part.bytes instanceof Uint8Array)
        || part.bytes.byteLength === 0
        || part.bytes.byteLength > MAX_PROVIDER_IMAGE_BYTES
      ) {
        throw invalidProviderInput('The Chat image content is invalid or too large.');
      }
    }
  }
  return {
    ...(request.systemInstruction ? { systemInstruction: request.systemInstruction } : {}),
    messages: request.messages,
  };
}

export function getLegacyProviderPrompt(
  request: TextGenerationProviderRequest,
): string {
  const conversation = validateProviderConversation(request);
  const onlyMessage = conversation.messages.length === 1
    ? conversation.messages[0]
    : undefined;
  const onlyPart = onlyMessage?.content.length === 1
    ? onlyMessage.content[0]
    : undefined;
  if (
    conversation.systemInstruction !== undefined
    || onlyMessage?.role !== 'user'
    || onlyPart?.type !== 'text'
  ) {
    throw invalidProviderInput('This Provider adapter does not support Chat messages yet.');
  }
  return onlyPart.text;
}

function invalidProviderInput(message: string): ChatError {
  return new ChatError(
    CHAT_ERROR_CODES.CHAT_INVALID_REQUEST,
    message,
    false,
  );
}

export type TextGenerationConnectionRequest = Omit<
  TextGenerationProviderRequest,
  | 'prompt'
  | 'systemInstruction'
  | 'messages'
  | 'signal'
  | 'requestUsage'
  | 'onTiming'
  | 'onUsage'
  | 'onFinishReason'
>;

export interface TextGenerationImageConnectionRequest
  extends TextGenerationConnectionRequest {
  mimeType: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
}

export function normalizeProviderFinishReason(value: unknown): ProviderFinishReason | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (['length', 'max_tokens', 'max_output_tokens'].includes(normalized)) return 'length';
  if (['stop', 'end_turn', 'end', 'completed'].includes(normalized)) return 'stop';
  if (['content_filter', 'content-filter', 'safety'].includes(normalized)) return 'content-filter';
  return 'other';
}

/**
 * Provider-neutral streaming text port. Protocol request/response shapes,
 * authentication headers, and SSE event parsing remain inside adapters.
 */
export interface TextGenerationProvider {
  stream(request: TextGenerationProviderRequest): AsyncIterable<string>;
  testConnection(request: TextGenerationConnectionRequest): Promise<void>;
  testImageConnection?(
    request: TextGenerationImageConnectionRequest,
  ): Promise<void>;
}
