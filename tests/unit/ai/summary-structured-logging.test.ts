import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CleanedContent } from '../../../src/shared/contracts/content.types';
import type { ShaleError } from '../../../src/shared/contracts/feed.ipc';
import type {
  SummaryDetailLevel,
  SummaryResult,
  SummaryRun,
  SummaryStreamEvent,
  SummaryTargetLanguage,
} from '../../../src/shared/contracts/summary.types';
import { SUMMARY_ERROR_CODES, SummaryError } from '../../../src/shared/errors/summary.errors';
import type { SummaryProvider, SummaryProviderRequest } from '../../../src/main/ai/provider/SummaryProvider';
import {
  logSummaryRunFailed,
  SUMMARY_LOG_ERROR_CODES,
  SUMMARY_LOG_EVENTS,
  type SummaryOperationLogger,
} from '../../../src/main/ai/services/SummaryLogging';
import { hashMarkdown, SummaryService } from '../../../src/main/ai/services/SummaryService';
import type { ProviderProfileStore, ActiveProviderProfile } from '../../../src/main/ai/stores/ProviderProfileStore';
import type { SecretStore } from '../../../src/main/ai/stores/SecretStore';
import type { SummaryStore } from '../../../src/main/ai/stores/SummaryStore';
import { StructuredLogger } from '../../../src/main/logging/StructuredLogger';

interface CapturedSummaryLog {
  level: 'info' | 'warn' | 'error';
  event: string;
  component: string;
  context: object;
}

interface SummaryStoreDouble {
  findResult(
    entryId: number,
    targetLanguage: SummaryTargetLanguage,
    detailLevel: SummaryDetailLevel,
  ): SummaryResult | undefined;
  createRun(params: {
    entryId: number;
    providerProfileId: number;
    targetLanguage: SummaryTargetLanguage;
    detailLevel: SummaryDetailLevel;
    inputMarkdownHash: string;
  }): SummaryRun;
  markRunSucceededWithResult(params: {
    runId: number;
    entryId: number;
    targetLanguage: SummaryTargetLanguage;
    detailLevel: SummaryDetailLevel;
    inputMarkdownHash: string;
    promptVersion: string;
    content: string;
  }): SummaryResult;
  markRunFailed(runId: number, error: ShaleError): void;
  reconcileInterruptedRuns(): number;
  findRunningRun(): undefined;
  findLatestFailedRun(): undefined;
}

interface SecretStoreDouble {
  read(reference: string): string;
}

const temporaryDirectories: string[] = [];
const request = {
  entryId: 11,
  targetLanguage: 'en' as const,
  detailLevel: 'medium' as const,
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createContent(markdown = 'A safe test article.'): CleanedContent {
  return {
    entryId: request.entryId,
    sourceUrl: 'https://content.example.test/article',
    cleanedHtml: '<article>Safe test article.</article>',
    markdown,
    pipelineStatus: 'success',
  };
}

function createProfile(overrides: Partial<ActiveProviderProfile> = {}): ActiveProviderProfile {
  return {
    id: 31,
    providerKind: 'openai',
    baseUrl: 'https://provider.example.test/v1',
    model: 'summary-test-model',
    apiKeyRef: 'summary-test-secret-reference',
    isActive: true,
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    ...overrides,
  };
}

function createProfileStore(profile: ActiveProviderProfile | undefined): ProviderProfileStore {
  return {
    findActiveWithSecret: vi.fn(() => profile),
  } as unknown as ProviderProfileStore;
}

function createSecretStore(apiKey = 'summary-test-api-key'): SecretStore {
  const double: SecretStoreDouble = { read: () => apiKey };
  return double as unknown as SecretStore;
}

function createSummaryStore(options: {
  existingResult?: SummaryResult;
  runId?: number;
  reconcileCount?: number;
  persistError?: Error;
} = {}): {
  store: SummaryStore;
  double: SummaryStoreDouble & {
    createRun: ReturnType<typeof vi.fn>;
    markRunSucceededWithResult: ReturnType<typeof vi.fn>;
    markRunFailed: ReturnType<typeof vi.fn>;
    getPersistedStatus(): 'running' | 'succeeded' | 'failed';
  };
} {
  const runId = options.runId ?? 701;
  let persistedStatus: 'running' | 'succeeded' | 'failed' = 'running';
  const double = {
    findResult: vi.fn(() => options.existingResult),
    createRun: vi.fn((params: {
      entryId: number;
      targetLanguage: SummaryTargetLanguage;
      detailLevel: SummaryDetailLevel;
    }) => ({
      id: runId,
      entryId: params.entryId,
      targetLanguage: params.targetLanguage,
      detailLevel: params.detailLevel,
      status: 'running' as const,
      createdAt: '2026-07-21T00:00:00.000Z',
    })),
    markRunSucceededWithResult: vi.fn((params: {
      runId: number;
      entryId: number;
      targetLanguage: SummaryTargetLanguage;
      detailLevel: SummaryDetailLevel;
      inputMarkdownHash: string;
      promptVersion: string;
      content: string;
    }) => {
      if (options.persistError) throw options.persistError;
      persistedStatus = 'succeeded';
      return {
        id: 801,
        runId: params.runId,
        entryId: params.entryId,
        targetLanguage: params.targetLanguage,
        detailLevel: params.detailLevel,
        content: params.content,
        inputMarkdownHash: params.inputMarkdownHash,
        promptVersion: params.promptVersion,
        createdAt: '2026-07-21T00:00:01.000Z',
        updatedAt: '2026-07-21T00:00:01.000Z',
      };
    }),
    markRunFailed: vi.fn(() => {
      if (persistedStatus === 'running') persistedStatus = 'failed';
    }),
    reconcileInterruptedRuns: vi.fn(() => options.reconcileCount ?? 0),
    findRunningRun: vi.fn(() => undefined),
    findLatestFailedRun: vi.fn(() => undefined),
    getPersistedStatus: () => persistedStatus,
  };
  return {
    store: double as unknown as SummaryStore,
    double: double as unknown as SummaryStoreDouble & {
      createRun: ReturnType<typeof vi.fn>;
      markRunSucceededWithResult: ReturnType<typeof vi.fn>;
      markRunFailed: ReturnType<typeof vi.fn>;
      getPersistedStatus(): 'running' | 'succeeded' | 'failed';
    },
  };
}

function createProvider(
  stream: (request: SummaryProviderRequest) => AsyncIterable<string>,
): SummaryProvider {
  return {
    stream,
    testConnection: async () => undefined,
  };
}

function streamChunks(chunks: string[]): (request: SummaryProviderRequest) => AsyncIterable<string> {
  return async function* stream(): AsyncIterable<string> {
    for (const chunk of chunks) yield chunk;
  };
}

function createCapturingLogger(logs: CapturedSummaryLog[]): SummaryOperationLogger {
  return {
    info(event, component, context) {
      logs.push({ level: 'info', event, component, context: { ...context } });
    },
    warn(event, component, context) {
      logs.push({ level: 'warn', event, component, context: { ...context } });
    },
    error(event, component, context) {
      logs.push({ level: 'error', event, component, context: { ...context } });
    },
  };
}

function createService(options: {
  content?: CleanedContent | undefined;
  profile?: ActiveProviderProfile | undefined;
  store?: SummaryStore;
  provider: SummaryProvider;
  logger?: SummaryOperationLogger;
  apiKey?: string;
}): SummaryService {
  const content = Object.prototype.hasOwnProperty.call(options, 'content')
    ? options.content
    : createContent();
  return new SummaryService(
    { findByEntry: () => content },
    createProfileStore(options.profile ?? createProfile()),
    createSecretStore(options.apiKey),
    options.store ?? createSummaryStore().store,
    options.provider,
    options.logger,
  );
}

async function waitForTerminalEvent(events: SummaryStreamEvent[]): Promise<void> {
  await vi.waitFor(() => {
    expect(events.some((event) => event.type === 'completed' || event.type === 'failed')).toBe(true);
  });
}

function expectDuration(log: CapturedSummaryLog | undefined): void {
  const duration = (log?.context as { durationMs?: unknown }).durationMs;
  expect(typeof duration).toBe('number');
  if (typeof duration !== 'number') return;
  expect(Number.isSafeInteger(duration)).toBe(true);
  expect(duration).toBeGreaterThanOrEqual(0);
}

describe('SummaryService structured logging', () => {
  it('records one started and one completed event for a persisted run, not its chunks', async () => {
    const logs: CapturedSummaryLog[] = [];
    const events: SummaryStreamEvent[] = [];
    const { store } = createSummaryStore({ runId: 711 });
    const service = createService({
      store,
      provider: createProvider(streamChunks(['Summary ', 'output.'])),
      logger: createCapturingLogger(logs),
    });
    service.subscribe((event) => events.push(event));

    expect(service.generate(request)).toEqual({ runId: 711, reused: false });
    await waitForTerminalEvent(events);

    expect(events.map((event) => event.type)).toEqual([
      'started',
      'delta',
      'delta',
      'completed',
    ]);
    expect(logs.map((log) => log.event)).toEqual([
      SUMMARY_LOG_EVENTS.runStarted,
      SUMMARY_LOG_EVENTS.runCompleted,
    ]);
    expect(logs[0].context).toEqual({ taskRunId: 711 });
    expect(logs[1].context).toMatchObject({ taskRunId: 711, success: true });
    expectDuration(logs[1]);
  });

  it('keeps a persisted success terminal when the completed listener throws', async () => {
    const logs: CapturedSummaryLog[] = [];
    const { store, double } = createSummaryStore({ runId: 712 });
    const service = createService({
      store,
      provider: createProvider(streamChunks(['completed output'])),
      logger: createCapturingLogger(logs),
    });
    const listenerError = new Error('COMPLETED_LISTENER_CANARY');
    service.subscribe((event) => {
      if (event.type === 'completed') throw listenerError;
    });

    expect(service.generate(request)).toEqual({ runId: 712, reused: false });
    await vi.waitFor(() => {
      expect(double.markRunSucceededWithResult).toHaveBeenCalledTimes(1);
    });

    expect(double.getPersistedStatus()).toBe('succeeded');
    expect(double.markRunFailed).not.toHaveBeenCalled();
    expect(logs.map((log) => log.event)).toEqual([
      SUMMARY_LOG_EVENTS.runStarted,
      SUMMARY_LOG_EVENTS.runCompleted,
    ]);
  });

  it('records one fixed failed event after a provider timeout', async () => {
    const logs: CapturedSummaryLog[] = [];
    const events: SummaryStreamEvent[] = [];
    const timeout = new SummaryError(
      SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_TIMEOUT,
      'PROVIDER_TIMEOUT_CANARY',
      true,
    );
    const service = createService({
      provider: createProvider(async function* stream(): AsyncIterable<string> {
        if (timeout) throw timeout;
        yield 'unreachable';
      }),
      logger: createCapturingLogger(logs),
    });
    service.subscribe((event) => events.push(event));

    service.generate(request);
    await waitForTerminalEvent(events);

    expect(logs).toHaveLength(2);
    expect(logs[1]).toMatchObject({
      level: 'error',
      event: SUMMARY_LOG_EVENTS.runFailed,
      context: {
        taskRunId: 701,
        success: false,
        stage: 'stream',
        errorCode: SUMMARY_LOG_ERROR_CODES.providerTimeout,
      },
    });
    expectDuration(logs[1]);
  });

  it('records empty output and result persistence failures without raw error text', async () => {
    const emptyLogs: CapturedSummaryLog[] = [];
    const emptyEvents: SummaryStreamEvent[] = [];
    const emptyService = createService({
      provider: createProvider(streamChunks(['  '])),
      logger: createCapturingLogger(emptyLogs),
    });
    emptyService.subscribe((event) => emptyEvents.push(event));

    emptyService.generate(request);
    await waitForTerminalEvent(emptyEvents);
    expect(emptyLogs[1].context).toMatchObject({
      stage: 'stream',
      errorCode: SUMMARY_LOG_ERROR_CODES.emptyOutput,
    });

    const persistLogs: CapturedSummaryLog[] = [];
    const persistEvents: SummaryStreamEvent[] = [];
    const persistError = new Error('PERSISTENCE_CANARY');
    const { store } = createSummaryStore({ persistError, runId: 713 });
    const persistService = createService({
      store,
      provider: createProvider(streamChunks(['output'])),
      logger: createCapturingLogger(persistLogs),
    });
    persistService.subscribe((event) => persistEvents.push(event));

    persistService.generate(request);
    await waitForTerminalEvent(persistEvents);
    expect(persistLogs[1].context).toMatchObject({
      taskRunId: 713,
      stage: 'persist',
      errorCode: SUMMARY_LOG_ERROR_CODES.unknownError,
    });
  });

  it('records the current stable interruption path once', async () => {
    const logs: CapturedSummaryLog[] = [];
    const events: SummaryStreamEvent[] = [];
    const provider = createProvider(async function* stream(
      providerRequest: SummaryProviderRequest,
    ): AsyncIterable<string> {
      await new Promise<void>((resolve) => {
        providerRequest.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      if (!providerRequest.signal.aborted) yield 'unreachable';
    });
    const service = createService({ provider, logger: createCapturingLogger(logs) });
    service.subscribe((event) => events.push(event));

    service.generate(request);
    service.abortActiveRun();
    await vi.waitFor(() => expect(events.map((event) => event.type)).toEqual(['started', 'failed']));

    expect(logs.map((log) => log.event)).toEqual([
      SUMMARY_LOG_EVENTS.runStarted,
      SUMMARY_LOG_EVENTS.runInterrupted,
    ]);
    expect(logs[1].context).toMatchObject({
      taskRunId: 701,
      success: false,
      stage: 'interrupt',
      errorCode: SUMMARY_LOG_ERROR_CODES.interrupted,
    });
  });

  it('does not log preflight rejection, cached reuse, or same-run reuse', async () => {
    const preflightLogs: CapturedSummaryLog[] = [];
    const preflightService = createService({
      content: undefined,
      provider: createProvider(streamChunks(['unused'])),
      logger: createCapturingLogger(preflightLogs),
    });
    expect(() => preflightService.generate(request)).toThrow(SummaryError);
    expect(preflightLogs).toEqual([]);

    const cachedLogs: CapturedSummaryLog[] = [];
    const content = createContent('CACHED_MARKDOWN_CANARY');
    const cachedResult: SummaryResult = {
      id: 901,
      runId: 902,
      entryId: request.entryId,
      targetLanguage: request.targetLanguage,
      detailLevel: request.detailLevel,
      content: 'CACHED_SUMMARY_CANARY',
      inputMarkdownHash: hashMarkdown(content.markdown),
      promptVersion: 'summary-v1',
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z',
    };
    const cachedService = createService({
      content,
      store: createSummaryStore({ existingResult: cachedResult }).store,
      provider: createProvider(streamChunks(['unused'])),
      logger: createCapturingLogger(cachedLogs),
    });
    expect(cachedService.generate(request)).toEqual({ runId: 902, reused: true });
    expect(cachedLogs).toEqual([]);

    const mergedLogs: CapturedSummaryLog[] = [];
    const pendingProvider = createProvider(async function* stream(
      providerRequest: SummaryProviderRequest,
    ): AsyncIterable<string> {
      await new Promise<void>((resolve) => {
        providerRequest.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      if (!providerRequest.signal.aborted) yield 'unreachable';
    });
    const mergedService = createService({
      provider: pendingProvider,
      logger: createCapturingLogger(mergedLogs),
    });
    const started = mergedService.generate(request);
    expect(mergedService.generate(request)).toEqual({ runId: started.runId, reused: true });
    expect(mergedLogs.map((log) => log.event)).toEqual([SUMMARY_LOG_EVENTS.runStarted]);
    mergedService.abortActiveRun();
  });

  it('isolates logger exceptions from Summary completion and failure persistence', async () => {
    const throwingLogger: SummaryOperationLogger = {
      info: () => { throw new Error('LOGGER_INFO_CANARY'); },
      warn: () => { throw new Error('LOGGER_WARN_CANARY'); },
      error: () => { throw new Error('LOGGER_ERROR_CANARY'); },
    };
    const successEvents: SummaryStreamEvent[] = [];
    const successStore = createSummaryStore();
    const successService = createService({
      store: successStore.store,
      provider: createProvider(streamChunks(['completed'])),
      logger: throwingLogger,
    });
    successService.subscribe((event) => successEvents.push(event));
    expect(successService.generate(request)).toEqual({ runId: 701, reused: false });
    await waitForTerminalEvent(successEvents);
    expect(successStore.double.markRunSucceededWithResult).toHaveBeenCalledTimes(1);

    const failureEvents: SummaryStreamEvent[] = [];
    const failureStore = createSummaryStore();
    const failureService = createService({
      store: failureStore.store,
      provider: createProvider(async function* stream(): AsyncIterable<string> {
        const failure = new Error('ORIGINAL_PROVIDER_FAILURE_CANARY');
        if (failure) throw failure;
        yield 'unreachable';
      }),
      logger: throwingLogger,
    });
    failureService.subscribe((event) => failureEvents.push(event));
    failureService.generate(request);
    await waitForTerminalEvent(failureEvents);
    expect(failureStore.double.markRunFailed).toHaveBeenCalledTimes(1);
  });

  it('drops illegal failure stage and error-code combinations before calling the logger', () => {
    const logs: CapturedSummaryLog[] = [];
    const logger = createCapturingLogger(logs);

    logSummaryRunFailed(logger, {
      taskRunId: 1,
      durationMs: 1,
      success: false,
      stage: 'free-text-stage' as never,
      errorCode: SUMMARY_LOG_ERROR_CODES.providerTimeout,
    });
    logSummaryRunFailed(logger, {
      taskRunId: 1,
      durationMs: 1,
      success: false,
      stage: 'persist',
      errorCode: SUMMARY_LOG_ERROR_CODES.providerTimeout as never,
    });

    expect(logs).toEqual([]);
  });

  it('records one aggregate startup recovery result', () => {
    const logs: CapturedSummaryLog[] = [];
    const { store, double } = createSummaryStore({ reconcileCount: 3 });
    const service = createService({
      store,
      provider: createProvider(streamChunks(['unused'])),
      logger: createCapturingLogger(logs),
    });

    service.reconcileInterruptedRuns();

    expect(double.reconcileInterruptedRuns).toHaveBeenCalledTimes(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'info',
      event: SUMMARY_LOG_EVENTS.recoveryCompleted,
      context: { count: 3 },
    });
    expectDuration(logs[0]);
  });

  it('keeps Summary privacy canaries out of logger arguments and JSONL', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'shale-summary-log-'));
    temporaryDirectories.push(directory);
    const jsonlLogger = new StructuredLogger({
      directory,
      now: () => new Date('2026-07-21T00:00:00.000Z'),
      createSessionId: () => 'summary-log-test-session',
    });
    const logs: CapturedSummaryLog[] = [];
    const observingLogger: SummaryOperationLogger = {
      info(event, component, context) {
        logs.push({ level: 'info', event, component, context: { ...context } });
        jsonlLogger.info(event, component, context);
      },
      warn(event, component, context) {
        logs.push({ level: 'warn', event, component, context: { ...context } });
        jsonlLogger.warn(event, component, context);
      },
      error(event, component, context) {
        logs.push({ level: 'error', event, component, context: { ...context } });
        jsonlLogger.error(event, component, context);
      },
    };
    const canaries = [
      'API_KEY_CANARY',
      'provider-private.example.test',
      'MODEL_CANARY',
      'ARTICLE_TITLE_CANARY',
      'ARTICLE_MARKDOWN_CANARY',
      'SUMMARY_OUTPUT_CANARY',
      'PROVIDER_RESPONSE_CANARY',
      'ORIGINAL_ERROR_CANARY',
    ];
    const events: SummaryStreamEvent[] = [];
    const service = createService({
      content: createContent(`${canaries[3]} ${canaries[4]}`),
      profile: createProfile({
        baseUrl: `https://${canaries[1]}/v1`,
        model: canaries[2],
        apiKeyRef: canaries[0],
      }),
      apiKey: canaries[0],
      provider: createProvider(async function* stream(
        providerRequest: SummaryProviderRequest,
      ): AsyncIterable<string> {
        expect(providerRequest.prompt).toContain(canaries[4]);
        const failure = new Error(canaries.slice(5).join('|'));
        if (failure) throw failure;
        yield 'unreachable';
      }),
      logger: observingLogger,
    });
    service.subscribe((event) => events.push(event));

    service.generate(request);
    await waitForTerminalEvent(events);
    await jsonlLogger.flush();

    const captured = JSON.stringify(logs);
    const jsonl = readdirSync(directory)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => readFileSync(path.join(directory, name), 'utf8'))
      .join('');
    for (const canary of canaries) {
      expect(captured).not.toContain(canary);
      expect(jsonl).not.toContain(canary);
    }
    expect(logs.map((log) => log.event)).toEqual([
      SUMMARY_LOG_EVENTS.runStarted,
      SUMMARY_LOG_EVENTS.runFailed,
    ]);
  });
});
