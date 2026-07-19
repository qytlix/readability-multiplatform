export interface SummaryProviderRequest {
  baseUrl: string;
  model: string;
  apiKey: string;
  prompt: string;
  signal: AbortSignal;
}

export interface SummaryProvider {
  stream(request: SummaryProviderRequest): AsyncIterable<string>;
  testConnection(request: Omit<SummaryProviderRequest, 'prompt' | 'signal'>): Promise<void>;
}
