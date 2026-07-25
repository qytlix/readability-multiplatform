import type { ProviderKind } from '../../../shared/contracts/provider.types';

export type ProviderTimingPhase = 'response-headers' | 'first-delta';

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
}

export type TextGenerationConnectionRequest = Omit<
  TextGenerationProviderRequest,
  'prompt' | 'signal' | 'requestUsage' | 'onTiming' | 'onUsage'
>;

/**
 * Provider-neutral streaming text port. Protocol request/response shapes,
 * authentication headers, and SSE event parsing remain inside adapters.
 */
export interface TextGenerationProvider {
  stream(request: TextGenerationProviderRequest): AsyncIterable<string>;
  testConnection(request: TextGenerationConnectionRequest): Promise<void>;
}

