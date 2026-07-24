import type { ProviderKind } from '../../../shared/contracts/provider.types';

export type ProviderTimingPhase = 'response-headers' | 'first-delta';

export interface TextGenerationProviderRequest {
  providerKind?: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  prompt: string;
  signal: AbortSignal;
  onTiming?: (phase: ProviderTimingPhase) => void;
}

export type TextGenerationConnectionRequest = Omit<
  TextGenerationProviderRequest,
  'prompt' | 'signal' | 'onTiming'
>;

/**
 * Provider-neutral streaming text port. Protocol request/response shapes,
 * authentication headers, and SSE event parsing remain inside adapters.
 */
export interface TextGenerationProvider {
  stream(request: TextGenerationProviderRequest): AsyncIterable<string>;
  testConnection(request: TextGenerationConnectionRequest): Promise<void>;
}

