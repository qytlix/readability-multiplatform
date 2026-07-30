import type { ProviderKind } from '../../../shared/contracts/provider.types';

export type ProviderTimingPhase = 'response-headers' | 'first-delta';
export const PROVIDER_FINISH_REASONS = ['stop', 'length', 'content-filter', 'other'] as const;
export type ProviderFinishReason = (typeof PROVIDER_FINISH_REASONS)[number];

/** Token values explicitly returned by a Provider response. */
export interface ProviderTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface TextGenerationProviderRequestBase {
  providerKind?: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  /**
   * 单轮调用的原始提示词。聊天调用保留空字符串，以兼容现有 Provider
   * 调用方，同时通过 messages 明确选择多轮协议。
   */
  prompt: string;
  /** 多轮聊天使用的系统指令。 */
  systemInstruction?: string;
  /** 多轮聊天历史；存在时 Provider 应按消息序列发送。 */
  messages?: ProviderMessage[];
  signal: AbortSignal;
  /** Requests usage metadata when the Provider supports it; response usage remains optional. */
  requestUsage?: boolean;
  onTiming?: (phase: ProviderTimingPhase) => void;
  onUsage?: (usage: ProviderTokenUsage) => void;
  /** A normalized completion reason when the selected provider exposes one. */
  onFinishReason?: (finishReason: ProviderFinishReason) => void;
}

export type TextGenerationProviderRequest = TextGenerationProviderRequestBase;

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
}

export function isConversationRequest(
  request: TextGenerationProviderRequest,
): request is TextGenerationProviderRequest & {
  systemInstruction: string;
  messages: ProviderMessage[];
} {
  return typeof request.systemInstruction === 'string'
    && Array.isArray(request.messages);
}
