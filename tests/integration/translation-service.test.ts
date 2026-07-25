import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { MockSummaryProvider } from '../../src/main/ai/provider/MockSummaryProvider';
import { ProviderProfileStore } from '../../src/main/ai/stores/ProviderProfileStore';
import { SecretStore, type SafeStorageBackend } from '../../src/main/ai/stores/SecretStore';
import type { SummaryProvider, SummaryProviderRequest } from '../../src/main/ai/provider/SummaryProvider';
import { TranslationService } from '../../src/main/ai/services/TranslationService';
import {
  TRANSLATION_LOG_ERROR_CODES,
  TRANSLATION_LOG_EVENTS,
  type TranslationOperationLogger,
} from '../../src/main/ai/services/TranslationLogging';
import { TranslationStore } from '../../src/main/ai/stores/TranslationStore';
import type { TerminologyLookup } from '../../src/main/ai/stores/TerminologyStore';
import { ContentStore } from '../../src/main/feed/stores/ContentStore';
import { SUMMARY_ERROR_CODES, SummaryError } from '../../src/shared/errors/summary.errors';
import {
  TRANSLATION_ERROR_CODES,
  TranslationError,
} from '../../src/shared/errors/translation.errors';
import type { TranslationStreamEvent } from '../../src/shared/contracts/translation.types';
import { buildTestDbWithData } from '../fixtures/databases/feed-fixture';

const memorySecrets = new Map<string, string>();
const fakeSafeStorage: SafeStorageBackend = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value),
  decryptString: (value) => value.toString('utf8'),
  getSelectedStorageBackend: () => 'gnome_libsecret',
};

class TestSecretStore extends SecretStore {
  constructor() {
    super('/tmp/unused-translation-secrets.json', fakeSafeStorage, 'linux');
  }

  override read(reference: string): string {
    const key = memorySecrets.get(reference);
    if (!key) throw new Error('Missing key');
    return key;
  }
}

interface BatchPromptSegment {
  sourceSegmentId: string;
  sourceHtml: string;
  terminologyCandidates: Array<{ id: string }>;
}

interface TranslationLogRecord {
  event: string;
  component: string;
  context: unknown;
}

function createCapturingLogger(records: TranslationLogRecord[]): TranslationOperationLogger {
  return {
    info: (event, component, context) => records.push({ event, component, context }),
    warn: (event, component, context) => records.push({ event, component, context }),
    error: (event, component, context) => records.push({ event, component, context }),
  };
}

class BatchMockProvider implements SummaryProvider {
  readonly prompts: string[] = [];
  activeStreams = 0;
  maxActiveStreams = 0;

  async *stream(request: SummaryProviderRequest): AsyncIterable<string> {
    this.prompts.push(request.prompt);
    this.activeStreams += 1;
    this.maxActiveStreams = Math.max(this.maxActiveStreams, this.activeStreams);
    try {
      await Promise.resolve();
      const segments = parseBatchPrompt(request.prompt);
      for (const segment of segments) {
        yield `${JSON.stringify(toBatchOutput(segment))}\n`;
      }
    } finally {
      this.activeStreams -= 1;
    }
  }

  testConnection(): Promise<void> {
    return Promise.resolve();
  }
}

function parseBatchPrompt(prompt: string): BatchPromptSegment[] {
  const serialized = prompt.match(
    /<source-segments-ndjson>\n([\s\S]*?)\n<\/source-segments-ndjson>/,
  )?.[1];
  if (!serialized) throw new Error('Missing source segments in batch prompt.');
  return serialized.split('\n').filter(Boolean).map((line) =>
    JSON.parse(line) as BatchPromptSegment);
}

function toBatchOutput(segment: BatchPromptSegment): Record<string, unknown> {
  const translatedHtml = segment.sourceHtml.replace(
    />([^<]*)</g,
    (_match, text: string) => text.trim() ? '>Translated paragraph.<' : `>${text}<`,
  );
  return {
    sourceSegmentId: segment.sourceSegmentId,
    translatedHtml,
    appliedTermIds: [],
  };
}

describe('TranslationService', () => {
  let contentStore: ContentStore;
  let database: Database.Database;
  let profileStore: ProviderProfileStore;
  let provider: BatchMockProvider;
  let service: TranslationService;

  beforeEach(() => {
    memorySecrets.clear();
    const { db } = buildTestDbWithData();
    database = db;
    contentStore = new ContentStore(db);
    contentStore.upsert({
      entryId: 1,
      cleanedHtml: '<p>First article paragraph.</p><p>Second article paragraph.</p>',
      markdown: 'First article paragraph.\n\nSecond article paragraph.',
      pipelineStatus: 'success',
    });
    profileStore = new ProviderProfileStore(db);
    profileStore.saveActive({
      baseUrl: 'https://provider.example/v1',
      model: 'mock-model',
      apiKeyRef: 'key-1',
    });
    memorySecrets.set('key-1', 'not-a-real-key');
    provider = new BatchMockProvider();
    service = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      new TranslationStore(db),
      provider,
    );
  });

  it('batches adjacent segments, persists each result, and reuses a compatible Translation', async () => {
    const events: string[] = [];
    const request = { entryId: 1, targetLanguage: 'zh-CN' as const };
    const persistedBeforeEvent: boolean[] = [];
    service.subscribe((event) => {
      events.push(event.type);
      if (event.type === 'segment-completed') {
        const stateAtEvent = service.getState(request);
        const storedSegment = stateAtEvent.state === 'running'
          ? stateAtEvent.result.segments.find((segment) =>
              segment.sourceSegmentId === event.sourceSegmentId)
          : undefined;
        persistedBeforeEvent.push(storedSegment?.status === 'succeeded');
      }
    });
    const stream = vi.spyOn(provider, 'stream');

    const started = service.generate(request);
    await vi.waitFor(() => {
      expect(service.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const state = service.getState(request);
    expect(state).toMatchObject({ state: 'succeeded' });
    if (state.state !== 'succeeded') throw new Error('Expected a completed Translation.');
    expect(state.result.segments).toHaveLength(3);
    expect(state.result.segments.every((segment) =>
      segment.translatedText === 'Translated paragraph.')).toBe(true);
    expect(state.result.segments.map((segment) => segment.sourceType)).toEqual([
      'title',
      'paragraph',
      'paragraph',
    ]);
    expect(events[0]).toBe('started');
    expect(events.at(-1)).toBe('completed');
    expect(events).not.toContain('segment-delta');
    expect(events.filter((event) => event === 'segment-completed')).toHaveLength(3);
    expect(persistedBeforeEvent).toEqual([true, true, true]);

    expect(service.generate(request)).toMatchObject({ runId: started.runId, reused: true });
    expect(stream).toHaveBeenCalledTimes(1);
    expect(provider.maxActiveStreams).toBe(1);
  });

  it('records only safe Translation lifecycle fields during a successful run', async () => {
    const articleCanary = 'ARTICLE_MARKDOWN_CANARY';
    const apiKeyCanary = 'API_KEY_CANARY';
    contentStore.upsert({
      entryId: 1,
      cleanedHtml: `<p>${articleCanary}</p>`,
      pipelineStatus: 'success',
    });
    memorySecrets.set('key-1', apiKeyCanary);
    const records: TranslationLogRecord[] = [];
    const loggingService = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      new TranslationStore(database),
      provider,
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, targetLanguage: 'zh-CN' as const };

    const started = loggingService.generate(request);
    await vi.waitFor(() => {
      expect(loggingService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    expect(records).toEqual([
      {
        event: TRANSLATION_LOG_EVENTS.runStarted,
        component: 'translation.run',
        context: { taskRunId: started.runId },
      },
      {
        event: TRANSLATION_LOG_EVENTS.providerRequestStarted,
        component: 'translation.provider.request',
        context: {
          taskRunId: started.runId,
          providerRequestId: expect.any(Number),
          requestKind: 'batch',
          segmentCount: 2,
        },
      },
      {
        event: TRANSLATION_LOG_EVENTS.providerRequestCompleted,
        component: 'translation.provider.request',
        context: {
          taskRunId: started.runId,
          providerRequestId: expect.any(Number),
          requestKind: 'batch',
          segmentCount: 2,
          durationMs: expect.any(Number),
          success: true,
        },
      },
      {
        event: TRANSLATION_LOG_EVENTS.runCompleted,
        component: 'translation.run',
        context: {
          taskRunId: started.runId,
          durationMs: expect.any(Number),
          success: true,
          providerRequestCount: 1,
          batchRequestCount: 1,
          compensationRequestCount: 0,
          providerRequestSuccessCount: 1,
          providerRequestFailureCount: 0,
          missingSegmentCount: 0,
        },
      },
    ]);
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain(articleCanary);
    expect(serialized).not.toContain(apiKeyCanary);
    expect(serialized).not.toContain('sourceSegmentId');
  });

  it('records concurrent batch request summaries without per-segment records', async () => {
    contentStore.upsert({
      entryId: 1,
      cleanedHtml: Array.from({ length: 7 }, (_, index) =>
        `<p>Article paragraph ${index + 1}.</p>`).join(''),
      pipelineStatus: 'success',
    });
    const records: TranslationLogRecord[] = [];
    const loggingService = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      new TranslationStore(database),
      provider,
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, targetLanguage: 'zh-CN' as const };

    loggingService.generate(request);
    await vi.waitFor(() => {
      expect(loggingService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const providerStarts = records.filter((record) =>
      record.event === TRANSLATION_LOG_EVENTS.providerRequestStarted);
    const providerCompletions = records.filter((record) =>
      record.event === TRANSLATION_LOG_EVENTS.providerRequestCompleted);
    const completedRun = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.runCompleted);
    expect(provider.maxActiveStreams).toBe(2);
    expect(providerStarts.map((record) => record.context)).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestKind: 'batch', segmentCount: 3 }),
      expect.objectContaining({ requestKind: 'batch', segmentCount: 3 }),
      expect.objectContaining({ requestKind: 'batch', segmentCount: 2 }),
    ]));
    const providerRequestIds = providerStarts.map((record) =>
      (record.context as { providerRequestId: number }).providerRequestId);
    expect(providerRequestIds.every(Number.isSafeInteger)).toBe(true);
    expect(new Set(providerRequestIds).size).toBe(3);
    expect(providerCompletions).toHaveLength(3);
    expect(providerCompletions.every((record) =>
      typeof (record.context as { durationMs?: unknown }).durationMs === 'number')).toBe(true);
    expect(completedRun?.context).toMatchObject({
      providerRequestCount: 3,
      batchRequestCount: 3,
      compensationRequestCount: 0,
      providerRequestSuccessCount: 3,
      providerRequestFailureCount: 0,
      missingSegmentCount: 0,
    });
    expect(records.map((record) => record.event)).not.toContain('translation.segment.completed');
  });

  it('records only the token usage returned by the Provider', async () => {
    let usageWasRequested = false;
    const usageProvider: SummaryProvider = {
      async *stream(providerRequest): AsyncIterable<string> {
        usageWasRequested = providerRequest.requestUsage === true;
        providerRequest.onUsage?.({ inputTokens: 11, outputTokens: 7 });
        for (const segment of parseBatchPrompt(providerRequest.prompt)) {
          yield `${JSON.stringify(toBatchOutput(segment))}\n`;
        }
      },
      testConnection: () => Promise.resolve(),
    };
    const records: TranslationLogRecord[] = [];
    const loggingService = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      new TranslationStore(database),
      usageProvider,
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, targetLanguage: 'zh-CN' as const };

    loggingService.generate(request);
    await vi.waitFor(() => {
      expect(loggingService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const completedRequest = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.providerRequestCompleted);
    const completedRun = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.runCompleted);
    expect(usageWasRequested).toBe(true);
    expect(completedRequest?.context).toMatchObject({ inputTokens: 11, outputTokens: 7 });
    expect(completedRun?.context).toMatchObject({ inputTokens: 11, outputTokens: 7 });
    expect(completedRequest?.context).not.toHaveProperty('totalTokens');
    expect(completedRun?.context).not.toHaveProperty('totalTokens');
  });

  it('recovers omissions in concurrent batches and continues queued Translation work', async () => {
    const { db } = buildTestDbWithData();
    const content = new ContentStore(db);
    content.upsert({
      entryId: 1,
      cleanedHtml: Array.from({ length: 7 }, (_, index) =>
        `<p>Article paragraph ${index + 1}.</p>`).join(''),
      pipelineStatus: 'success',
    });
    const profiles = new ProviderProfileStore(db);
    profiles.saveActive({
      baseUrl: 'https://provider.example/v1',
      model: 'mock-model',
      apiKeyRef: 'key-omitted-segment',
    });
    memorySecrets.set('key-omitted-segment', 'not-a-real-key');
    const prompts: BatchPromptSegment[][] = [];
    const omittedSourceSegmentIds = new Set<string>();
    const omittingProvider: SummaryProvider = {
      async *stream(providerRequest): AsyncIterable<string> {
        const segments = parseBatchPrompt(providerRequest.prompt);
        prompts.push(segments);
        const returnedSegments = segments.length > 1 ? segments.slice(0, -1) : segments;
        if (segments.length > 1) {
          const omittedSegment = segments.at(-1);
          if (omittedSegment) omittedSourceSegmentIds.add(omittedSegment.sourceSegmentId);
        }
        for (const segment of returnedSegments) {
          yield `${JSON.stringify(toBatchOutput(segment))}\n`;
        }
      },
      testConnection: () => Promise.resolve(),
    };
    const records: TranslationLogRecord[] = [];
    const recoveringService = new TranslationService(
      content,
      profiles,
      new TestSecretStore(),
      new TranslationStore(db),
      omittingProvider,
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, targetLanguage: 'zh-CN' as const };

    recoveringService.generate(request);
    await vi.waitFor(() => {
      expect(recoveringService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const state = recoveringService.getState(request);
    if (state.state !== 'succeeded') throw new Error('Expected a recovered Translation.');
    expect(state.result.segments).toHaveLength(8);
    expect(state.result.segments.every((segment) => segment.status === 'succeeded')).toBe(true);
    expect(prompts.map((segments) => segments.length).sort()).toEqual([1, 1, 1, 2, 3, 3]);
    const recoverySourceSegmentIds = prompts
      .filter((segments) => segments.length === 1)
      .map((segments) => segments[0]?.sourceSegmentId);
    expect(new Set(recoverySourceSegmentIds)).toEqual(omittedSourceSegmentIds);
    const missingSegmentRecords = records.filter((record) =>
      record.event === TRANSLATION_LOG_EVENTS.missingSegmentsDetected);
    const compensationStarts = records.filter((record) =>
      record.event === TRANSLATION_LOG_EVENTS.providerRequestStarted
      && (record.context as { requestKind?: unknown }).requestKind === 'compensation');
    const completedRun = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.runCompleted);
    expect(missingSegmentRecords).toHaveLength(3);
    expect(missingSegmentRecords.every((record) =>
      (record.context as { missingSegmentCount?: unknown }).missingSegmentCount === 1)).toBe(true);
    expect(compensationStarts).toHaveLength(3);
    expect(compensationStarts.every((record) =>
      (record.context as { segmentCount?: unknown }).segmentCount === 1)).toBe(true);
    expect(completedRun?.context).toMatchObject({
      providerRequestCount: 6,
      batchRequestCount: 3,
      compensationRequestCount: 3,
      providerRequestSuccessCount: 6,
      providerRequestFailureCount: 0,
      missingSegmentCount: 3,
    });
  });

  it('compensates only the remaining segments after a batch has invalid structure', async () => {
    const prompts: BatchPromptSegment[][] = [];
    const records: TranslationLogRecord[] = [];
    const invalidBatchProvider: SummaryProvider = {
      async *stream(providerRequest): AsyncIterable<string> {
        const segments = parseBatchPrompt(providerRequest.prompt);
        prompts.push(segments);
        if (segments.length > 1) {
          const first = segments[0];
          if (!first) throw new Error('Expected a batch segment.');
          yield `${JSON.stringify(toBatchOutput(first))}\n`;
          yield 'invalid-translation-ndjson\n';
          return;
        }
        const segment = segments[0];
        if (!segment) throw new Error('Expected a compensation segment.');
        yield `${JSON.stringify(toBatchOutput(segment))}\n`;
      },
      testConnection: () => Promise.resolve(),
    };
    const recoveringService = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      new TranslationStore(database),
      invalidBatchProvider,
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, targetLanguage: 'zh-CN' as const };

    recoveringService.generate(request);
    await vi.waitFor(() => {
      expect(recoveringService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const state = recoveringService.getState(request);
    if (state.state !== 'succeeded') throw new Error('Expected a recovered Translation.');
    expect(state.result.segments.every((segment) => segment.status === 'succeeded')).toBe(true);
    expect(prompts.map((segments) => segments.length)).toEqual([3, 1, 1]);
    const batchSegmentIds = new Set(prompts[0]?.map((segment) => segment.sourceSegmentId));
    const compensationSegmentIds = prompts.slice(1).map((segments) => segments[0]?.sourceSegmentId);
    expect(new Set(compensationSegmentIds).size).toBe(2);
    expect(compensationSegmentIds.every((sourceSegmentId) => batchSegmentIds.has(sourceSegmentId)))
      .toBe(true);

    const compensationStarts = records.filter((record) =>
      record.event === TRANSLATION_LOG_EVENTS.providerRequestStarted
      && (record.context as { requestKind?: unknown }).requestKind === 'compensation');
    const completedRun = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.runCompleted);
    expect(compensationStarts).toHaveLength(2);
    expect(completedRun?.context).toMatchObject({
      providerRequestCount: 3,
      batchRequestCount: 1,
      compensationRequestCount: 2,
      providerRequestSuccessCount: 2,
      providerRequestFailureCount: 1,
      missingSegmentCount: 2,
    });
  });

  it('compensates all remaining segments after a batch returns empty output', async () => {
    const prompts: BatchPromptSegment[][] = [];
    const records: TranslationLogRecord[] = [];
    const emptyBatchProvider: SummaryProvider = {
      async *stream(providerRequest): AsyncIterable<string> {
        const segments = parseBatchPrompt(providerRequest.prompt);
        prompts.push(segments);
        if (segments.length > 1) {
          throw new TranslationError(
            TRANSLATION_ERROR_CODES.TRANSLATION_EMPTY_OUTPUT,
            'The provider returned a Translation segment without readable text.',
            true,
          );
        }
        const segment = segments[0];
        if (!segment) throw new Error('Expected a compensation segment.');
        yield `${JSON.stringify(toBatchOutput(segment))}\n`;
      },
      testConnection: () => Promise.resolve(),
    };
    const recoveringService = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      new TranslationStore(database),
      emptyBatchProvider,
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, targetLanguage: 'zh-CN' as const };

    recoveringService.generate(request);
    await vi.waitFor(() => {
      expect(recoveringService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const compensationStarts = records.filter((record) =>
      record.event === TRANSLATION_LOG_EVENTS.providerRequestStarted
      && (record.context as { requestKind?: unknown }).requestKind === 'compensation');
    const completedRun = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.runCompleted);
    expect(prompts.map((segments) => segments.length)).toEqual([3, 1, 1, 1]);
    expect(compensationStarts).toHaveLength(3);
    expect(completedRun?.context).toMatchObject({
      providerRequestCount: 4,
      batchRequestCount: 1,
      compensationRequestCount: 3,
      providerRequestSuccessCount: 3,
      providerRequestFailureCount: 1,
      missingSegmentCount: 3,
    });
  });

  it.each([
    TRANSLATION_ERROR_CODES.TRANSLATION_EMPTY_OUTPUT,
    TRANSLATION_ERROR_CODES.TRANSLATION_INVALID_STRUCTURE,
  ])('isolates a %s segment after compensation and continues independent batches', async (
    segmentErrorCode,
  ) => {
    const markerText = 'Untranslatable marker.';
    contentStore.upsert({
      entryId: 1,
      cleanedHtml: [
        `<p>${markerText}</p>`,
        ...Array.from({ length: 6 }, (_, index) => `<p>Article paragraph ${index + 2}.</p>`),
      ].join(''),
      pipelineStatus: 'success',
    });
    const prompts: BatchPromptSegment[][] = [];
    const records: TranslationLogRecord[] = [];
    const markerProvider: SummaryProvider = {
      async *stream(providerRequest): AsyncIterable<string> {
        const segments = parseBatchPrompt(providerRequest.prompt);
        prompts.push(segments);
        for (const segment of segments) {
          if (segment.sourceHtml.includes(markerText)) {
            throw new TranslationError(
              segmentErrorCode,
              'The provider returned an invalid Translation segment.',
              true,
            );
          }
          yield `${JSON.stringify(toBatchOutput(segment))}\n`;
        }
      },
      testConnection: () => Promise.resolve(),
    };
    const isolatedFailureService = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      new TranslationStore(database),
      markerProvider,
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, targetLanguage: 'zh-CN' as const };
    const events: TranslationStreamEvent[] = [];
    isolatedFailureService.subscribe((event) => events.push(event));

    isolatedFailureService.generate(request);
    await vi.waitFor(() => {
      expect(isolatedFailureService.getState(request)).toMatchObject({ state: 'failed' });
    });

    const state = isolatedFailureService.getState(request);
    if (state.state !== 'failed') throw new Error('Expected a partially failed Translation.');
    const markerSegment = state.result.segments.find((segment) =>
      segment.sourceText === markerText);
    expect(markerSegment).toMatchObject({
      status: 'failed',
      error: { code: segmentErrorCode },
    });
    expect(state.result.segments.filter((segment) => segment.status === 'succeeded')).toHaveLength(7);
    expect(prompts.filter((segments) => segments.length > 1)).toHaveLength(3);
    expect(prompts.filter((segments) =>
      segments.length === 1 && segments[0]?.sourceHtml.includes(markerText))).toHaveLength(1);
    expect(events.find((event) => event.type === 'segment-failed')).toMatchObject({
      sourceSegmentId: markerSegment?.sourceSegmentId,
      segment: {
        status: 'failed',
        error: { code: segmentErrorCode },
      },
    });

    const failedRun = records.find((record) => record.event === TRANSLATION_LOG_EVENTS.runFailed);
    expect(failedRun?.context).toMatchObject({
      errorCode: segmentErrorCode,
      providerRequestCount: 5,
      batchRequestCount: 3,
      compensationRequestCount: 2,
      providerRequestSuccessCount: 3,
      providerRequestFailureCount: 2,
      missingSegmentCount: 2,
    });
  });

  it('fails without recursively compensating when a structure-error recovery request fails', async () => {
    const prompts: BatchPromptSegment[][] = [];
    const recoveryFailureProvider: SummaryProvider = {
      async *stream(providerRequest): AsyncIterable<string> {
        const segments = parseBatchPrompt(providerRequest.prompt);
        prompts.push(segments);
        if (segments.length > 1) {
          yield 'invalid-translation-ndjson\n';
          return;
        }
        throw new SummaryError(
          SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_TIMEOUT,
          'Provider timed out during compensation.',
          true,
        );
      },
      testConnection: () => Promise.resolve(),
    };
    const failingRecoveryService = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      new TranslationStore(database),
      recoveryFailureProvider,
    );
    const request = { entryId: 1, targetLanguage: 'zh-CN' as const };

    failingRecoveryService.generate(request);
    await vi.waitFor(() => {
      expect(failingRecoveryService.getState(request)).toMatchObject({ state: 'failed' });
    });

    const state = failingRecoveryService.getState(request);
    if (state.state !== 'failed') throw new Error('Expected a failed Translation.');
    expect(state.result.error).toMatchObject({ code: 'TRANSLATION_PROVIDER_TIMEOUT' });
    expect(state.result.segments.filter((segment) => segment.status !== 'succeeded')).toHaveLength(3);
    expect(prompts.map((segments) => segments.length)).toEqual([3, 1]);
  });

  it('persists already-target-language segments without calling the provider', async () => {
    database.prepare('UPDATE entry SET title = ?, author = ? WHERE id = 1')
      .run('这是中文标题', '测试作者');
    contentStore.upsert({
      entryId: 1,
      cleanedHtml: '<h2>软件使用方法</h2><p>这是一篇已经写好的中文文章。</p>',
      pipelineStatus: 'success',
    });
    const request = { entryId: 1, targetLanguage: 'zh-CN' as const };
    const stream = vi.spyOn(provider, 'stream');

    service.generate(request);
    await vi.waitFor(() => {
      expect(service.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const state = service.getState(request);
    if (state.state !== 'succeeded') throw new Error('Expected a completed Translation.');
    expect(stream).not.toHaveBeenCalled();
    expect(state.result.segments).toHaveLength(3);
    expect(state.result.segments.every((segment) =>
      segment.status === 'succeeded'
      && segment.translatedText === segment.sourceText
      && segment.translatedHtml === segment.sourceHtml)).toBe(true);
  });

  it('locally completes icon, divider, and number-only segments without provider requests', async () => {
    contentStore.upsert({
      entryId: 1,
      cleanedHtml: [
        '<p>✦ — ✦</p>',
        '<p>123 — 456</p>',
        '<p>A paragraph that still needs translation.</p>',
      ].join(''),
      pipelineStatus: 'success',
    });
    const request = { entryId: 1, targetLanguage: 'zh-CN' as const };

    service.generate(request);
    await vi.waitFor(() => {
      expect(service.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const state = service.getState(request);
    if (state.state !== 'succeeded') throw new Error('Expected a completed Translation.');
    const localSegments = state.result.segments.filter((segment) =>
      segment.sourceText === '✦ — ✦' || segment.sourceText === '123 — 456');
    expect(localSegments).toHaveLength(2);
    expect(localSegments.every((segment) =>
      segment.status === 'succeeded'
      && segment.translatedText === segment.sourceText
      && segment.translatedHtml === segment.sourceHtml)).toBe(true);

    const sentSegmentIds = provider.prompts.flatMap((prompt) =>
      parseBatchPrompt(prompt).map((segment) => segment.sourceSegmentId));
    expect(localSegments.every((segment) =>
      !sentSegmentIds.includes(segment.sourceSegmentId))).toBe(true);
  });

  it('does not expose a Translation produced for changed content', async () => {
    const request = { entryId: 1, targetLanguage: 'en' as const };
    service.generate(request);
    await vi.waitFor(() => {
      expect(service.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    contentStore.upsert({
      entryId: 1,
      cleanedHtml: '<p>A changed article paragraph.</p>',
      pipelineStatus: 'success',
    });

    expect(service.getState(request)).toEqual({ state: 'stale' });
  });

  it('rebuilds current segments when Reader title metadata changes', async () => {
    const request = { entryId: 1, targetLanguage: 'en' as const };
    service.generate(request);
    await vi.waitFor(() => {
      expect(service.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    database.prepare('UPDATE entry SET title = ? WHERE id = 1')
      .run('Updated Reader title');

    expect(service.getState(request)).toEqual({ state: 'stale' });
  });

  it('uses contextual local candidates and persists the applied pack provenance', async () => {
    const lookupContexts: string[] = [];
    const terminologyLookup: TerminologyLookup = {
      getVersion: () => 'test-pack@2026-07-19',
      getInfo: () => ({
        version: 'test-pack@2026-07-19',
        sources: [],
      }),
      findCandidates: (text) => {
        lookupContexts.push(text);
        return [{
          sourceId: 'test-pack',
          conceptId: 'concept-1',
          sourceTerm: 'article',
          targetTerm: '文章',
        }];
      },
    };
    const contextualProvider: SummaryProvider = {
      async *stream(request): AsyncIterable<string> {
        for (const segment of parseBatchPrompt(request.prompt)) {
          yield `${JSON.stringify({
            sourceSegmentId: segment.sourceSegmentId,
            translatedHtml: segment.sourceHtml,
            appliedTermIds: ['test-pack:concept-1'],
          })}\n`;
        }
      },
      testConnection: () => Promise.resolve(),
    };
    const { db } = buildTestDbWithData();
    const content = new ContentStore(db);
    content.upsert({
      entryId: 1,
      cleanedHtml: '<p>First article paragraph.</p>',
      pipelineStatus: 'success',
    });
    const profiles = new ProviderProfileStore(db);
    profiles.saveActive({
      baseUrl: 'https://provider.example/v1',
      model: 'mock-model',
      apiKeyRef: 'key-terms',
    });
    memorySecrets.set('key-terms', 'not-a-real-key');
    const contextualService = new TranslationService(
      content,
      profiles,
      new TestSecretStore(),
      new TranslationStore(db),
      contextualProvider,
      undefined,
      terminologyLookup,
    );
    const request = { entryId: 1, targetLanguage: 'zh-CN' as const };

    contextualService.generate(request);
    await vi.waitFor(() => {
      expect(contextualService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const state = contextualService.getState(request);
    if (state.state !== 'succeeded') throw new Error('Expected a completed Translation.');
    expect(state.result.terminologyPackVersion).toBe('test-pack@2026-07-19');
    expect(state.result.segments[0]?.terminologyMatches).toContainEqual(
      expect.objectContaining({ conceptId: 'concept-1', targetTerm: '文章' }),
    );
    expect(lookupContexts.some((context) => context.includes('First article paragraph.')))
      .toBe(true);

    lookupContexts.length = 0;
    contextualService.generate({ ...request, useTerminology: false });
    await vi.waitFor(() => {
      expect(contextualService.getState({ ...request, useTerminology: false }))
        .toMatchObject({ state: 'succeeded' });
    });
    const terminologyDisabledState = contextualService.getState({
      ...request,
      useTerminology: false,
    });
    if (terminologyDisabledState.state !== 'succeeded') {
      throw new Error('Expected a completed Translation without terminology.');
    }
    expect(terminologyDisabledState.result.terminologyPackVersion).toBe('none');
    expect(terminologyDisabledState.result.segments.every((segment) =>
      segment.terminologyMatches.length === 0)).toBe(true);
    expect(lookupContexts).toEqual([]);
  });

  it('prioritizes a visible batch before queued off-screen work', async () => {
    contentStore.upsert({
      entryId: 1,
      cleanedHtml: Array.from({ length: 7 }, (_, index) =>
        `<p>Paragraph ${index + 1}.</p>`).join(''),
      pipelineStatus: 'success',
    });
    const request = { entryId: 1, targetLanguage: 'zh-CN' as const };

    const started = service.generate(request);
    const visibleId = started.result.segments.at(-1)?.sourceSegmentId;
    if (!visibleId) throw new Error('Expected a visible segment ID.');
    expect(service.prioritize({ ...request, runId: started.runId, sourceSegmentIds: [visibleId] }))
      .toEqual({ accepted: true });
    await vi.waitFor(() => {
      expect(service.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    expect(provider.prompts[0]).toContain(`"sourceSegmentId":"${visibleId}"`);
    expect(provider.maxActiveStreams).toBe(2);
  });

  it('retries only unfinished segments with new provider request IDs while preserving completed output', async () => {
    const { db } = buildTestDbWithData();
    const content = new ContentStore(db);
    content.upsert({
      entryId: 1,
      cleanedHtml: '<p>Only article paragraph.</p>',
      pipelineStatus: 'success',
    });
    const profiles = new ProviderProfileStore(db);
    profiles.saveActive({
      baseUrl: 'https://provider.example/v1',
      model: 'mock-model',
      apiKeyRef: 'key-resume',
    });
    memorySecrets.set('key-resume', 'not-a-real-key');
    let shouldFail = true;
    const prompts: string[] = [];
    const records: TranslationLogRecord[] = [];
    const resumableProvider: SummaryProvider = {
      async *stream(providerRequest): AsyncIterable<string> {
        prompts.push(providerRequest.prompt);
        const segments = parseBatchPrompt(providerRequest.prompt);
        const first = segments[0];
        if (!first) throw new Error('Expected a segment.');
        yield `${JSON.stringify(toBatchOutput(first))}\n`;
        if (shouldFail) {
          shouldFail = false;
          throw new SummaryError(
            SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_TIMEOUT,
            'Provider timed out.',
            true,
          );
        }
        for (const segment of segments.slice(1)) {
          yield `${JSON.stringify(toBatchOutput(segment))}\n`;
        }
      },
      testConnection: () => Promise.resolve(),
    };
    const resumableService = new TranslationService(
      content,
      profiles,
      new TestSecretStore(),
      new TranslationStore(db),
      resumableProvider,
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, targetLanguage: 'zh-CN' as const };
    const firstRun = resumableService.generate(request);
    await vi.waitFor(() => {
      expect(resumableService.getState(request)).toMatchObject({ state: 'failed' });
    });
    const failed = resumableService.getState(request);
    if (failed.state !== 'failed') throw new Error('Expected a failed Translation.');
    const completedId = failed.result.segments.find((segment) =>
      segment.status === 'succeeded')?.sourceSegmentId;
    if (!completedId) throw new Error('Expected one persisted segment.');

    const resumed = resumableService.generate(request);
    expect(resumed.runId).toBe(firstRun.runId);
    await vi.waitFor(() => {
      expect(resumableService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).not.toContain(`"sourceSegmentId":"${completedId}"`);
    const providerStarts = records.filter((record) =>
      record.event === TRANSLATION_LOG_EVENTS.providerRequestStarted);
    const providerRequestIds = providerStarts.map((record) =>
      (record.context as { providerRequestId: number }).providerRequestId);
    expect(providerStarts.every((record) =>
      (record.context as { taskRunId: number }).taskRunId === firstRun.runId)).toBe(true);
    expect(providerRequestIds).toHaveLength(2);
    expect(new Set(providerRequestIds).size).toBe(2);
  });

  it('does not compensate a mapped provider timeout and preserves the incomplete run', async () => {
    const { db } = buildTestDbWithData();
    const content = new ContentStore(db);
    content.upsert({ entryId: 1, cleanedHtml: '<p>Article paragraph.</p>', pipelineStatus: 'success' });
    const profiles = new ProviderProfileStore(db);
    profiles.saveActive({
      baseUrl: 'https://provider.example/v1',
      model: 'mock-model',
      apiKeyRef: 'key-3',
    });
    memorySecrets.set('key-3', 'not-a-real-key');
    const records: TranslationLogRecord[] = [];
    const failingService = new TranslationService(
      content,
      profiles,
      new TestSecretStore(),
      new TranslationStore(db),
      new MockSummaryProvider([], new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_TIMEOUT,
        'Provider timed out.',
        true,
      )),
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, targetLanguage: 'zh-CN' as const };

    failingService.generate(request);
    await vi.waitFor(() => {
      expect(failingService.getState(request)).toMatchObject({ state: 'failed' });
    });

    const failedState = failingService.getState(request);
    expect(failedState).toMatchObject({
      state: 'failed',
      result: {
        error: { code: 'TRANSLATION_PROVIDER_TIMEOUT', retryable: true },
      },
    });
    if (failedState.state !== 'failed') throw new Error('Expected a failed Translation.');
    expect(failedState.result.segments[0]).toMatchObject({
      status: 'failed',
      error: { code: 'TRANSLATION_PROVIDER_TIMEOUT' },
    });
    expect(failedState.result.segments.slice(1).every((segment) =>
      segment.status === 'pending')).toBe(true);
    expect(records).toEqual([
      {
        event: TRANSLATION_LOG_EVENTS.runStarted,
        component: 'translation.run',
        context: { taskRunId: failedState.result.id },
      },
      {
        event: TRANSLATION_LOG_EVENTS.providerRequestStarted,
        component: 'translation.provider.request',
        context: {
          taskRunId: failedState.result.id,
          providerRequestId: expect.any(Number),
          requestKind: 'batch',
          segmentCount: 2,
        },
      },
      {
        event: TRANSLATION_LOG_EVENTS.providerRequestFailed,
        component: 'translation.provider.request',
        context: {
          taskRunId: failedState.result.id,
          providerRequestId: expect.any(Number),
          requestKind: 'batch',
          segmentCount: 2,
          durationMs: expect.any(Number),
          success: false,
          errorCode: TRANSLATION_LOG_ERROR_CODES.providerTimeout,
        },
      },
      {
        event: TRANSLATION_LOG_EVENTS.runFailed,
        component: 'translation.run',
        context: {
          taskRunId: failedState.result.id,
          durationMs: expect.any(Number),
          success: false,
          stage: 'stream',
          errorCode: TRANSLATION_LOG_ERROR_CODES.providerTimeout,
          providerRequestCount: 1,
          batchRequestCount: 1,
          compensationRequestCount: 0,
          providerRequestSuccessCount: 0,
          providerRequestFailureCount: 1,
          missingSegmentCount: 0,
        },
      },
    ]);
  });

  it('permits only one active Translation at a time', () => {
    const pendingProvider: SummaryProvider = {
      async *stream(request: SummaryProviderRequest): AsyncIterable<string> {
        await new Promise<void>((resolve) => {
          request.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        if (!request.signal.aborted) yield 'unreachable';
      },
      testConnection: () => Promise.resolve(),
    };
    const { db } = buildTestDbWithData();
    const content = new ContentStore(db);
    content.upsert({ entryId: 1, cleanedHtml: '<p>First</p>', pipelineStatus: 'success' });
    content.upsert({ entryId: 2, cleanedHtml: '<p>Second</p>', pipelineStatus: 'success' });
    const profiles = new ProviderProfileStore(db);
    profiles.saveActive({
      baseUrl: 'https://provider.example/v1',
      model: 'mock-model',
      apiKeyRef: 'key-2',
    });
    memorySecrets.set('key-2', 'not-a-real-key');
    const pendingService = new TranslationService(
      content,
      profiles,
      new TestSecretStore(),
      new TranslationStore(db),
      pendingProvider,
    );

    pendingService.generate({ entryId: 1, targetLanguage: 'en' });
    expect(() => pendingService.generate({ entryId: 2, targetLanguage: 'en' }))
      .toThrow('Another Translation is already being generated');
    pendingService.abortActiveRun();
  });
});
