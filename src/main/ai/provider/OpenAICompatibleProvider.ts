import { SUMMARY_ERROR_CODES, SummaryError } from '../../../shared/errors/summary.errors';
import type { SummaryProvider, SummaryProviderRequest } from './SummaryProvider';

const REQUEST_TIMEOUT_MS = 60_000;

/** Minimal OpenAI-compatible Chat Completions streaming adapter. */
export class OpenAICompatibleProvider implements SummaryProvider {
  async *stream(request: SummaryProviderRequest): AsyncIterable<string> {
    const timeoutController = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, REQUEST_TIMEOUT_MS);
    const abortFromCaller = () => timeoutController.abort();
    request.signal.addEventListener('abort', abortFromCaller, { once: true });

    try {
      const response = await this.request(
        { ...request, signal: timeoutController.signal },
        {
          model: request.model,
          stream: true,
          messages: [{ role: 'user', content: request.prompt }],
        },
      );

      if (!response.body) {
        throw new SummaryError(
          SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_REQUEST_FAILED,
          'The provider did not return a streaming response.',
          true,
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';

      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch {
          if (timedOut) {
            throw new SummaryError(
              SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_TIMEOUT,
              'The provider did not respond before the request timed out.',
              true,
            );
          }
          if (request.signal.aborted) {
            throw new SummaryError(
              SUMMARY_ERROR_CODES.SUMMARY_INTERRUPTED,
              'Summary generation was interrupted.',
              true,
            );
          }
          throw new SummaryError(
            SUMMARY_ERROR_CODES.SUMMARY_NETWORK_ERROR,
            'The provider stream ended unexpectedly.',
            true,
          );
        }
        if (chunk.done) break;

        pending += decoder.decode(chunk.value, { stream: true });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? '';
        for (const line of lines) {
          const delta = parseStreamDelta(line);
          if (delta) yield delta;
        }
      }

      const finalDelta = parseStreamDelta(pending);
      if (finalDelta) yield finalDelta;
    } catch (error) {
      if (timedOut) {
        throw new SummaryError(
          SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_TIMEOUT,
          'The provider did not respond before the request timed out.',
          true,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener('abort', abortFromCaller);
    }
  }

  async testConnection(
    request: Omit<SummaryProviderRequest, 'prompt' | 'signal'>,
  ): Promise<void> {
    const controller = new AbortController();
    const response = await this.request(
      { ...request, prompt: '', signal: controller.signal },
      {
        model: request.model,
        stream: false,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
      },
    );
    // A successful protocol response is sufficient; response text may be sensitive.
    await response.body?.cancel();
  }

  private async request(
    request: SummaryProviderRequest,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort();
    request.signal.addEventListener('abort', abortFromCaller, { once: true });

    try {
      const response = await fetch(buildCompletionUrl(request.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${request.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new SummaryError(
            SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_AUTH,
            'The provider rejected the configured API key.',
            false,
          );
        }
        throw new SummaryError(
          SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_REQUEST_FAILED,
          `The provider request failed with status ${response.status}.`,
          response.status >= 500 || response.status === 429,
        );
      }

      return response;
    } catch (error) {
      if (error instanceof SummaryError) throw error;
      if (timedOut) {
        throw new SummaryError(
          SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_TIMEOUT,
          'The provider did not respond before the request timed out.',
          true,
        );
      }
      if (request.signal.aborted) {
        throw new SummaryError(
          SUMMARY_ERROR_CODES.SUMMARY_INTERRUPTED,
          'Summary generation was interrupted.',
          true,
        );
      }
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_NETWORK_ERROR,
        'Unable to reach the configured provider.',
        true,
      );
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener('abort', abortFromCaller);
    }
  }
}

function buildCompletionUrl(baseUrl: string): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL('chat/completions', normalized).toString();
}

function parseStreamDelta(line: string): string | undefined {
  if (!line.startsWith('data:')) return undefined;
  const payload = line.slice('data:'.length).trim();
  if (!payload || payload === '[DONE]') return undefined;

  try {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: unknown } }>;
    };
    const content = parsed.choices?.[0]?.delta?.content;
    return typeof content === 'string' ? content : undefined;
  } catch {
    return undefined;
  }
}
