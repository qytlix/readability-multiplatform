import type { SummaryProvider, SummaryProviderRequest } from './SummaryProvider';

/** Deterministic test-only provider; it never performs network I/O. */
export class MockSummaryProvider implements SummaryProvider {
  constructor(
    private readonly chunks: string[] = ['Mock ', 'summary.'],
    private readonly error?: Error,
  ) {}

  async *stream(request: SummaryProviderRequest): AsyncIterable<string> {
    if (this.error) throw this.error;
    for (const chunk of this.chunks) {
      if (request.signal.aborted) throw new Error('Aborted');
      yield chunk;
    }
  }

  async testConnection(): Promise<void> {
    if (this.error) throw this.error;
  }
}
