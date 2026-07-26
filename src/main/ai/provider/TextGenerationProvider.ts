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

export interface TextGenerationProviderRequest {
  providerKind?: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  prompt: string;
  signal: AbortSignal;
  /** Requests usage metadata when the Provider supports it; response usage remains optional. */
  requestUsage?: boolean;
  onTiming?: (phase: ProviderTimingPhase) => void;
  onUsage?: (usage: ProviderTokenUsage) => void;
  /** A normalized completion reason when the selected provider exposes one. */
  onFinishReason?: (finishReason: ProviderFinishReason) => void;
}

export type TextGenerationConnectionRequest = Omit<
  TextGenerationProviderRequest,
  'prompt' | 'signal' | 'requestUsage' | 'onTiming' | 'onUsage' | 'onFinishReason'
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
