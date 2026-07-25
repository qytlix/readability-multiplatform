import type { ProviderTokenUsage } from './ProviderTokenUsage';

export type { ProviderTokenUsage } from './ProviderTokenUsage';

export interface SummaryProviderRequest {
  baseUrl: string;
  model: string;
  apiKey: string;
  prompt: string;
  signal: AbortSignal;
  /** Requests usage metadata when the Provider supports it; response usage remains optional. */
  requestUsage?: boolean;
  onTiming?: (phase: 'response-headers' | 'first-delta') => void;
  onUsage?: (usage: ProviderTokenUsage) => void;
}

export interface SummaryProvider {
  stream(request: SummaryProviderRequest): AsyncIterable<string>;
  testConnection(request: Omit<SummaryProviderRequest, 'prompt' | 'signal'>): Promise<void>;
}
