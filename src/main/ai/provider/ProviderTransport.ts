import { SUMMARY_ERROR_CODES, SummaryError } from '../../../shared/errors/summary.errors';

const REQUEST_TIMEOUT_MS = 60_000;

export interface ProviderAbortScope {
  signal: AbortSignal;
  callerSignal?: AbortSignal;
  didTimeOut: () => boolean;
  dispose: () => void;
}

export interface ServerSentEvent {
  event?: string;
  data: string;
}

export function createProviderAbortScope(callerSignal?: AbortSignal): ProviderAbortScope {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  return {
    signal: controller.signal,
    callerSignal,
    didTimeOut: () => timedOut,
    dispose: () => {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

export async function fetchProviderResponse(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  scope: ProviderAbortScope,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: scope.signal });
  } catch (error) {
    throw mapTransportFailure(scope, error);
  }

  if (response.ok) return response;

  void response.body?.cancel();
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
    response.status === 408 || response.status === 429 || response.status >= 500,
  );
}

export async function* readServerSentEvents(
  response: Response,
  scope: ProviderAbortScope,
): AsyncIterable<ServerSentEvent> {
  if (!response.body) {
    throw providerProtocolError('The provider did not return a streaming response.', true);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let eventName: string | undefined;

  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        throw mapTransportFailure(scope, error, true);
      }
      if (chunk.done) break;

      pending += decoder.decode(chunk.value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const rawLine of lines) {
        const parsed = parseSseLine(rawLine, eventName);
        eventName = parsed.nextEventName;
        if (parsed.event) yield parsed.event;
      }
    }

    pending += decoder.decode();
    if (pending) {
      const parsed = parseSseLine(pending, eventName);
      if (parsed.event) yield parsed.event;
    }
  } finally {
    reader.releaseLock();
  }
}

export function providerProtocolError(
  message = 'The provider returned an invalid response.',
  retryable = false,
): SummaryError {
  return new SummaryError(
    SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_REQUEST_FAILED,
    message,
    retryable,
  );
}

export function providerStreamError(retryable: boolean): SummaryError {
  return new SummaryError(
    SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_REQUEST_FAILED,
    'The provider reported an error while generating text.',
    retryable,
  );
}

function parseSseLine(
  rawLine: string,
  currentEventName: string | undefined,
): {
  nextEventName?: string;
  event?: ServerSentEvent;
} {
  const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
  if (!line) return {};
  if (line.startsWith(':')) return { nextEventName: currentEventName };
  if (line.startsWith('event:')) {
    return { nextEventName: line.slice('event:'.length).trim() || undefined };
  }
  if (!line.startsWith('data:')) {
    return { nextEventName: currentEventName };
  }
  return {
    event: {
      ...(currentEventName ? { event: currentEventName } : {}),
      data: line.slice('data:'.length).trimStart(),
    },
  };
}

function mapTransportFailure(
  scope: ProviderAbortScope,
  error: unknown,
  duringStream = false,
): SummaryError {
  if (error instanceof SummaryError) return error;
  if (scope.didTimeOut()) {
    return new SummaryError(
      SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_TIMEOUT,
      'The provider did not respond before the request timed out.',
      true,
    );
  }
  if (scope.callerSignal?.aborted) {
    return new SummaryError(
      SUMMARY_ERROR_CODES.SUMMARY_INTERRUPTED,
      'AI generation was interrupted.',
      true,
    );
  }
  return new SummaryError(
    SUMMARY_ERROR_CODES.SUMMARY_NETWORK_ERROR,
    duringStream
      ? 'The provider stream ended unexpectedly.'
      : 'Unable to reach the configured provider.',
    true,
  );
}

