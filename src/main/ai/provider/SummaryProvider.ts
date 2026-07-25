/** Token values explicitly returned by a Provider response. */
export interface ProviderTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

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
