import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { MockSummaryProvider } from '../../src/main/ai/provider/MockSummaryProvider';
import { ProviderProfileStore } from '../../src/main/ai/stores/ProviderProfileStore';
import { SecretStore, type SafeStorageBackend } from '../../src/main/ai/stores/SecretStore';
import type { SummaryProvider, SummaryProviderRequest } from '../../src/main/ai/provider/SummaryProvider';
import { TranslationService } from '../../src/main/ai/services/TranslationService';
import { TranslationContextService } from '../../src/main/ai/services/TranslationContextService';
import { TranslationExpertService } from '../../src/main/ai/services/TranslationExpertService';
import { UsageRecorder } from '../../src/main/ai/services/UsageRecorder';
import {
  TRANSLATION_LOG_ERROR_CODES,
  TRANSLATION_LOG_EVENTS,
  type TranslationOperationLogger,
} from '../../src/main/ai/services/TranslationLogging';
import { TranslationStore } from '../../src/main/ai/stores/TranslationStore';
import { TranslationContextStore } from '../../src/main/ai/stores/TranslationContextStore';
import { TranslationExpertStore } from '../../src/main/ai/stores/TranslationExpertStore';
import builtInExpertBundle from '../../resources/ai-experts/experts.json';
import type { BuiltInExpertBundle } from '../../src/shared/contracts/translation-expert.types';
import { UsageStore } from '../../src/main/ai/stores/UsageStore';
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

interface TextSlotPromptSlot {
  textSlotId: string;
  sourceText: string;
}

interface BatchProviderOutput {
  sourceSegmentId: string;
  translatedHtml: string;
  appliedTermIds: string[];
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
  readonly providerKinds: Array<SummaryProviderRequest['providerKind']> = [];
  readonly models: string[] = [];
  activeStreams = 0;
  maxActiveStreams = 0;

  async *stream(request: SummaryProviderRequest): AsyncIterable<string> {
    this.prompts.push(request.prompt);
    this.providerKinds.push(request.providerKind);
    this.models.push(request.model);
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

function parseTextSlotPrompt(prompt: string): TextSlotPromptSlot[] {
  const serialized = prompt.match(
    /<text-slots-ndjson>\n([\s\S]*?)\n<\/text-slots-ndjson>/,
  )?.[1];
  if (!serialized) throw new Error('Missing text slots in Translation compensation prompt.');
  return serialized.split('\n').filter(Boolean).map((line) =>
    JSON.parse(line) as TextSlotPromptSlot);
}

function toBatchOutput(segment: BatchPromptSegment): BatchProviderOutput {
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
  let usageStore: UsageStore;

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
      summary: {
        providerKind: 'openai',
        baseUrl: 'https://provider.example/v1',
        model: 'summary-model',
        apiKeyRef: 'summary-key-1',
      },
      translation: {
        providerKind: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'translation-model',
        apiKeyRef: 'key-1',
      },
    });
    memorySecrets.set('summary-key-1', 'not-a-real-summary-key');
    memorySecrets.set('key-1', 'not-a-real-key');
    provider = new BatchMockProvider();
    usageStore = new UsageStore(db);
    service = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      new TranslationStore(db),
      provider,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new UsageRecorder(usageStore),
    );
  });

  it('does not log startup recovery when no Translation run was reconciled', () => {
    const records: TranslationLogRecord[] = [];
    const recoveringService = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      new TranslationStore(database),
      provider,
      undefined,
      undefined,
      undefined,
      undefined,
      createCapturingLogger(records),
    );

    recoveringService.reconcileInterruptedRuns();

    expect(records).toEqual([]);
  });

  it('logs startup recovery with its derived trigger when a Translation run was reconciled', () => {
    const records: TranslationLogRecord[] = [];
    const translationStore = new TranslationStore(database);
    const profile = profileStore.findActiveWithSecret();
    if (!profile) throw new Error('Expected an active test provider profile.');
    translationStore.createRun({
      entryId: 1,
      providerProfileId: profile.id,
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN',
      sourceContentHash: 'startup-recovery-source',
      segmenterVersion: 'test-segmenter',
      promptVersion: 'test-prompt',
      terminologyPackVersion: 'test-terminology',
      segments: [{
        id: 'startup-recovery-segment',
        orderIndex: 0,
        type: 'paragraph',
        sourceHtml: '<p>Recovery test.</p>',
        sourceText: 'Recovery test.',
      }],
    });
    const recoveringService = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      translationStore,
      provider,
      undefined,
      undefined,
      undefined,
      undefined,
      createCapturingLogger(records),
    );

    recoveringService.reconcileInterruptedRuns();

    expect(records).toEqual([
      expect.objectContaining({
        event: TRANSLATION_LOG_EVENTS.recoveryCompleted,
        component: 'translation.recovery',
        context: expect.objectContaining({
          count: 1,
          trigger: 'startup-recovery',
        }),
      }),
    ]);
  });

  it('batches adjacent segments, persists each result, and reuses a compatible Translation', async () => {
    const events: string[] = [];
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };
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
    expect(provider.providerKinds).toEqual(['deepseek']);
    expect(provider.models).toEqual(['translation-model']);
  });

  it('creates a fresh, usage-tracked run when retranslation is explicitly requested', async () => {
    const records: TranslationLogRecord[] = [];
    const retranslationService = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      new TranslationStore(database),
      provider,
      undefined,
      undefined,
      undefined,
      undefined,
      createCapturingLogger(records),
      new UsageRecorder(usageStore),
    );
    const request = {
      entryId: 1,
      sourceLanguage: 'auto' as const,
      targetLanguage: 'zh-CN' as const,
    };

    const original = retranslationService.generate(request);
    await vi.waitFor(() => {
      expect(retranslationService.getState(request)).toMatchObject({
        state: 'succeeded',
        result: { id: original.runId },
      });
    });

    const replacement = retranslationService.generate({ ...request, forceNew: true });
    expect(replacement.reused).toBe(false);
    expect(replacement.runId).not.toBe(original.runId);
    expect(replacement.activeResult?.id).toBe(original.runId);
    await vi.waitFor(() => {
      expect(retranslationService.getState(request)).toMatchObject({
        state: 'succeeded',
        result: { id: replacement.runId },
      });
    });

    expect(provider.prompts).toHaveLength(2);
    expect(usageStore.listByTask('translation', original.runId)).toHaveLength(1);
    expect(usageStore.listByTask('translation', replacement.runId)).toHaveLength(1);
    expect(records).toEqual([
      expect.objectContaining({
        event: TRANSLATION_LOG_EVENTS.runStarted,
        context: expect.objectContaining({
          taskRunId: original.runId,
          trigger: 'initial',
          previousResultAtStart: 'none',
        }),
      }),
      expect.objectContaining({
        event: TRANSLATION_LOG_EVENTS.runCompleted,
        context: expect.objectContaining({
          taskRunId: original.runId,
          trigger: 'initial',
          previousResultOutcome: 'none',
        }),
      }),
      expect.objectContaining({
        event: TRANSLATION_LOG_EVENTS.runStarted,
        context: expect.objectContaining({
          taskRunId: replacement.runId,
          trigger: 'force-new',
          previousResultAtStart: 'retained',
        }),
      }),
      expect.objectContaining({
        event: TRANSLATION_LOG_EVENTS.runCompleted,
        context: expect.objectContaining({
          taskRunId: replacement.runId,
          trigger: 'force-new',
          previousResultOutcome: 'replaced',
        }),
      }),
    ]);
  });

  it('keeps API keys and article content out of Translation diagnostics', async () => {
    const apiKeyCanary = 'sk-m6-private-api-key-canary';
    const articleCanary = 'M6_PRIVATE_ARTICLE_BODY_CANARY';
    memorySecrets.set('key-1', apiKeyCanary);
    contentStore.upsert({
      entryId: 1,
      cleanedHtml: `<p>${articleCanary}</p>`,
      markdown: articleCanary,
      pipelineStatus: 'success',
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const request = {
      entryId: 1,
      sourceLanguage: 'auto' as const,
      targetLanguage: 'fr' as const,
    };

    try {
      service.generate(request);
      await vi.waitFor(() => {
        expect(service.getState(request)).toMatchObject({ state: 'succeeded' });
      });

      const diagnostics = JSON.stringify([
        ...info.mock.calls,
        ...warn.mock.calls,
      ]);
      expect(diagnostics).toBe('[]');
      expect(diagnostics).not.toContain(apiKeyCanary);
      expect(diagnostics).not.toContain(articleCanary);
      expect(diagnostics).not.toMatch(/authorization|bearer/i);
    } finally {
      info.mockRestore();
      warn.mockRestore();
    }
  });

  it('keeps manual and automatic source-language cache identities separate', async () => {
    const automaticRequest = {
      entryId: 1,
      sourceLanguage: 'auto' as const,
      targetLanguage: 'fr' as const,
    };
    const manualRequest = {
      entryId: 1,
      sourceLanguage: 'en' as const,
      targetLanguage: 'fr' as const,
    };

    const automatic = service.generate(automaticRequest);
    await vi.waitFor(() => {
      expect(service.getState(automaticRequest)).toMatchObject({ state: 'succeeded' });
    });
    const manual = service.generate(manualRequest);
    await vi.waitFor(() => {
      expect(service.getState(manualRequest)).toMatchObject({ state: 'succeeded' });
    });

    expect(manual.reused).toBe(false);
    expect(manual.runId).not.toBe(automatic.runId);
    expect(service.getState(automaticRequest)).toMatchObject({
      result: { sourceLanguage: 'auto', targetLanguage: 'fr' },
    });
    expect(service.getState(manualRequest)).toMatchObject({
      result: { sourceLanguage: 'en', targetLanguage: 'fr' },
    });
    expect(provider.prompts.some((prompt) =>
      prompt.includes('Detect the source language'))).toBe(true);
    expect(provider.prompts.some((prompt) =>
      prompt.includes('The source language is English.'))).toBe(true);
  });

  it('runs all target languages across the five provider presets', async () => {
    const combinations = [
      { providerKind: 'openai', sourceLanguage: 'de', targetLanguage: 'en' },
      { providerKind: 'deepseek', sourceLanguage: 'en', targetLanguage: 'zh-CN' },
      { providerKind: 'openrouter', sourceLanguage: 'en', targetLanguage: 'zh-HK' },
      { providerKind: 'anthropic', sourceLanguage: 'en', targetLanguage: 'ja' },
      { providerKind: 'gemini', sourceLanguage: 'en', targetLanguage: 'ko' },
      { providerKind: 'openai', sourceLanguage: 'en', targetLanguage: 'de' },
      { providerKind: 'anthropic', sourceLanguage: 'en', targetLanguage: 'fr' },
      { providerKind: 'gemini', sourceLanguage: 'en', targetLanguage: 'es' },
    ] as const;

    for (const [index, combination] of combinations.entries()) {
      const { db } = buildTestDbWithData();
      const content = new ContentStore(db);
      content.upsert({
        entryId: 1,
        cleanedHtml: combination.sourceLanguage === 'de'
          ? '<p>Diese Anwendung verarbeitet Nachrichten zuverlässig.</p>'
          : '<p>This application processes messages reliably.</p>',
        pipelineStatus: 'success',
      });
      const profiles = new ProviderProfileStore(db);
      const keyReference = `matrix-key-${index}`;
      profiles.saveActive({
        providerKind: combination.providerKind,
        baseUrl: 'https://provider.example/v1',
        model: 'matrix-model',
        apiKeyRef: keyReference,
      });
      memorySecrets.set(keyReference, 'not-a-real-key');
      const matrixProvider = new BatchMockProvider();
      const matrixService = new TranslationService(
        content,
        profiles,
        new TestSecretStore(),
        new TranslationStore(db),
        matrixProvider,
      );
      const request = {
        entryId: 1,
        sourceLanguage: combination.sourceLanguage,
        targetLanguage: combination.targetLanguage,
      };

      matrixService.generate(request);
      await vi.waitFor(() => {
        expect(matrixService.getState(request)).toMatchObject({ state: 'succeeded' });
      });
      expect(matrixProvider.providerKinds).toContain(combination.providerKind);
      db.close();
    }

    expect(new Set(combinations.map(({ targetLanguage }) => targetLanguage)).size).toBe(8);
    expect(new Set(combinations.map(({ providerKind }) => providerKind))).toEqual(new Set([
      'openai',
      'deepseek',
      'openrouter',
      'anthropic',
      'gemini',
    ]));
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
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

    const started = loggingService.generate(request);
    await vi.waitFor(() => {
      expect(loggingService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    expect(records).toEqual([
      {
        event: TRANSLATION_LOG_EVENTS.runStarted,
        component: 'translation.run',
        context: {
          taskRunId: started.runId,
          trigger: 'initial',
          previousResultAtStart: 'none',
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
          unresolvedMissingSegmentCount: 0,
          trigger: 'initial',
          previousResultOutcome: 'none',
        },
      },
    ]);
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain(articleCanary);
    expect(serialized).not.toContain(apiKeyCanary);
    expect(serialized).not.toContain('sourceSegmentId');
    expect(serialized).not.toContain('Translated paragraph.');
    expect(serialized).not.toContain('<source-segments-ndjson>');
  });

  it('records one task summary for concurrent batch work without per-segment records', async () => {
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
      undefined,
      undefined,
      createCapturingLogger(records),
      new UsageRecorder(usageStore),
    );
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

    const started = loggingService.generate(request);
    await vi.waitFor(() => {
      expect(loggingService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const completedRun = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.runCompleted);
    expect(provider.maxActiveStreams).toBe(2);
    expect(records.map((record) => record.event)).toEqual([
      TRANSLATION_LOG_EVENTS.runStarted,
      TRANSLATION_LOG_EVENTS.runCompleted,
    ]);
    expect(completedRun?.context).toMatchObject({
      providerRequestCount: 3,
      batchRequestCount: 3,
      compensationRequestCount: 0,
      providerRequestSuccessCount: 3,
      providerRequestFailureCount: 0,
      missingSegmentCount: 0,
      unresolvedMissingSegmentCount: 0,
    });
    const usageRecords = usageStore.listByTask('translation', started.runId);
    expect(usageRecords).toHaveLength(3);
    expect(usageRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requestKind: 'batch',
        requestStatus: 'succeeded',
        usageAvailability: 'missing',
      }),
    ]));
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
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

    loggingService.generate(request);
    await vi.waitFor(() => {
      expect(loggingService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const completedRun = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.runCompleted);
    expect(usageWasRequested).toBe(true);
    expect(completedRun?.context).toMatchObject({ inputTokens: 11, outputTokens: 7 });
    expect(completedRun?.context).not.toHaveProperty('totalTokens');
  });

  it('persists distinct batch and compensation requests under the same Translation run', async () => {
    const logs: TranslationLogRecord[] = [];
    const compensationProvider: SummaryProvider = {
      async *stream(providerRequest): AsyncIterable<string> {
        const segments = parseBatchPrompt(providerRequest.prompt);
        providerRequest.onUsage?.({ inputTokens: 11, outputTokens: 7, totalTokens: 18 });
        const returnedSegments = segments.length > 1 ? segments.slice(0, -1) : segments;
        for (const segment of returnedSegments) {
          yield `${JSON.stringify(toBatchOutput(segment))}\n`;
        }
      },
      testConnection: () => Promise.resolve(),
    };
    const ledgerService = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      new TranslationStore(database),
      compensationProvider,
      undefined,
      undefined,
      undefined,
      undefined,
      createCapturingLogger(logs),
      new UsageRecorder(usageStore),
    );
    const request = {
      entryId: 1,
      sourceLanguage: 'auto' as const,
      targetLanguage: 'zh-CN' as const,
    };

    const started = ledgerService.generate(request);
    await vi.waitFor(() => {
      expect(ledgerService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const usageRecords = usageStore.listByTask('translation', started.runId);
    expect(usageRecords).toHaveLength(2);
    expect(usageRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        taskType: 'translation',
        taskRunId: started.runId,
        attemptId: expect.any(String),
        requestKind: 'batch',
        requestStatus: 'succeeded',
        usageAvailability: 'reported',
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18,
      }),
      expect.objectContaining({
        taskType: 'translation',
        taskRunId: started.runId,
        attemptId: expect.any(String),
        requestKind: 'compensation',
        requestStatus: 'succeeded',
        usageAvailability: 'reported',
      }),
    ]));
    expect(logs.map((record) => record.event)).toEqual([
      TRANSLATION_LOG_EVENTS.runStarted,
      TRANSLATION_LOG_EVENTS.missingSegmentsDetected,
      TRANSLATION_LOG_EVENTS.runCompleted,
    ]);
    expect(new Set(usageRecords.map((record) => record.providerRequestId)).size).toBe(2);
    expect(new Set(usageRecords.map((record) => record.attemptId)).size).toBe(1);
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
      providerKind: 'openai',
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
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

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
    const completedRun = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.runCompleted);
    expect(missingSegmentRecords).toHaveLength(3);
    expect(missingSegmentRecords.every((record) =>
      (record.context as { missingSegmentCount?: unknown }).missingSegmentCount === 1)).toBe(true);
    expect(records.map((record) => record.event)).toEqual([
      TRANSLATION_LOG_EVENTS.runStarted,
      TRANSLATION_LOG_EVENTS.missingSegmentsDetected,
      TRANSLATION_LOG_EVENTS.missingSegmentsDetected,
      TRANSLATION_LOG_EVENTS.missingSegmentsDetected,
      TRANSLATION_LOG_EVENTS.runCompleted,
    ]);
    expect(completedRun?.context).toMatchObject({
      providerRequestCount: 6,
      batchRequestCount: 3,
      compensationRequestCount: 3,
      providerRequestSuccessCount: 6,
      providerRequestFailureCount: 0,
      missingSegmentCount: 3,
      unresolvedMissingSegmentCount: 0,
    });
  });

  it('rejects mixed-script output and retries affected segments before persistence', async () => {
    const prompts: BatchPromptSegment[][] = [];
    const records: TranslationLogRecord[] = [];
    const mixedLanguageProvider: SummaryProvider = {
      async *stream(providerRequest): AsyncIterable<string> {
        const segments = parseBatchPrompt(providerRequest.prompt);
        prompts.push(segments);
        for (const [index, segment] of segments.entries()) {
          const translatedHtml = segments.length > 1 && index === 1
            ? '<p>Deadline指出，这起诉讼在加州法律下是否वास्तव可执行。</p>'
            : segment.sourceHtml.replace(
                />([^<]*)</g,
                (_match, text: string) => text.trim() ? '>有效的中文译文。<' : `>${text}<`,
              );
          yield `${JSON.stringify({
            sourceSegmentId: segment.sourceSegmentId,
            translatedHtml,
            appliedTermIds: [],
          })}\n`;
        }
      },
      testConnection: () => Promise.resolve(),
    };
    const recoveringService = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      new TranslationStore(database),
      mixedLanguageProvider,
      undefined,
      undefined,
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = {
      entryId: 1,
      sourceLanguage: 'auto' as const,
      targetLanguage: 'zh-CN' as const,
    };

    recoveringService.generate(request);
    await vi.waitFor(() => {
      expect(recoveringService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const state = recoveringService.getState(request);
    if (state.state !== 'succeeded') throw new Error('Expected a recovered Translation.');
    expect(state.result.segments.every((segment) =>
      segment.translatedText === '有效的中文译文。')).toBe(true);
    expect(JSON.stringify(state.result)).not.toContain('वास्तव');
    expect(prompts.map((segments) => segments.length)).toEqual([3, 1, 1]);

    const rejectedBatch = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.providerRequestFailed
      && (record.context as { requestKind?: unknown }).requestKind === 'batch');
    expect(rejectedBatch?.context).toMatchObject({
      reasonCode: 'target_language_mismatch',
      validationStage: 'language-validation',
      acceptedSegmentCount: 1,
      missingSegmentCount: 2,
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
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

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

    const completedRun = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.runCompleted);
    const malformedBatch = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.providerRequestFailed
      && (record.context as { requestKind?: unknown }).requestKind === 'batch');
    expect(malformedBatch?.context).toMatchObject({
      errorCode: TRANSLATION_LOG_ERROR_CODES.invalidStructure,
      reasonCode: 'ndjson_syntax_error',
      validationStage: 'stream',
      expectedSegmentCount: 3,
      parsedSegmentCount: 1,
      acceptedSegmentCount: 1,
      missingSegmentCount: 2,
      duplicateSegmentCount: 0,
      unexpectedSegmentCount: 0,
      malformedRecordCount: 1,
      emptyTranslationCount: 0,
      inputCharacters: expect.any(Number),
      outputCharacters: expect.any(Number),
      affectedSegmentIdHashes: expect.arrayContaining([
        expect.stringMatching(/^[a-f0-9]{16}$/),
      ]),
    });
    expect(completedRun?.context).toMatchObject({
      providerRequestCount: 3,
      batchRequestCount: 1,
      compensationRequestCount: 2,
      providerRequestSuccessCount: 2,
      providerRequestFailureCount: 1,
      missingSegmentCount: 2,
      unresolvedMissingSegmentCount: 0,
    });
  });

  it('classifies an HTML-rejected segment and completes only its remaining compensation', async () => {
    const outputCanary = 'RAW_HTML_REJECTION_CANARY';
    const prompts: BatchPromptSegment[][] = [];
    const textSlotPrompts: TextSlotPromptSlot[][] = [];
    const records: TranslationLogRecord[] = [];
    const htmlRejectingProvider: SummaryProvider = {
      async *stream(providerRequest): AsyncIterable<string> {
        if (providerRequest.prompt.includes('<text-slots-ndjson>')) {
          const textSlots = parseTextSlotPrompt(providerRequest.prompt);
          textSlotPrompts.push(textSlots);
          for (const [index, textSlot] of textSlots.entries()) {
            yield `${JSON.stringify({
              textSlotId: textSlot.textSlotId,
              translatedText: `Translated slot ${index + 1}.`,
              appliedTermIds: [],
            })}\n`;
          }
          return;
        }
        const segments = parseBatchPrompt(providerRequest.prompt);
        prompts.push(segments);
        providerRequest.onFinishReason?.('stop');
        if (segments.length > 1) {
          const first = segments[0];
          const rejected = segments[1];
          if (!first || !rejected) throw new Error('Expected a batch with two segments.');
          yield `${JSON.stringify(toBatchOutput(first))}\n`;
          yield `${JSON.stringify({
            ...toBatchOutput(rejected),
            translatedHtml: rejected.sourceHtml.replace(
              /(<\/[A-Za-z][^>]*>)\s*$/,
              `<em>${outputCanary}</em>$1`,
            ),
          })}\n`;
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
      htmlRejectingProvider,
      undefined,
      undefined,
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

    recoveringService.generate(request);
    await vi.waitFor(() => {
      expect(recoveringService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const state = recoveringService.getState(request);
    if (state.state !== 'succeeded') throw new Error('Expected a recovered Translation.');
    expect(state.result.segments.every((segment) => segment.status === 'succeeded')).toBe(true);
    expect(prompts.map((segments) => segments.length)).toEqual([3, 1]);
    expect(textSlotPrompts).toHaveLength(1);
    expect(textSlotPrompts[0]?.map((slot) => slot.textSlotId)).toEqual(['slot-0001']);
    const initialBatchIds = new Set(prompts[0]?.map((segment) => segment.sourceSegmentId));
    const normalCompensationIds = prompts.slice(1).map((segments) => segments[0]?.sourceSegmentId);
    expect(new Set(normalCompensationIds).size).toBe(1);
    expect(normalCompensationIds.every((sourceSegmentId) => initialBatchIds.has(sourceSegmentId)))
      .toBe(true);

    const rejectedBatch = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.providerRequestFailed
      && (record.context as { requestKind?: unknown }).requestKind === 'batch');
    const omission = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.missingSegmentsDetected
      && (record.context as { requestKind?: unknown }).requestKind === 'batch');
    const completedRun = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.runCompleted);
    const expectedHtmlDiagnostic = {
      reasonCode: 'html_structure_invalid',
      validationStage: 'html-validation',
      htmlValidationReason: 'html_element_count_mismatch',
      finishReason: 'stop',
      expectedSegmentCount: 3,
      parsedSegmentCount: 2,
      acceptedSegmentCount: 1,
      missingSegmentCount: 2,
      duplicateSegmentCount: 0,
      unexpectedSegmentCount: 0,
      malformedRecordCount: 0,
      emptyTranslationCount: 0,
      affectedSegmentIdHashes: expect.arrayContaining([
        expect.stringMatching(/^[a-f0-9]{16}$/),
      ]),
    };
    expect(rejectedBatch?.context).toMatchObject({
      errorCode: TRANSLATION_LOG_ERROR_CODES.invalidStructure,
      ...expectedHtmlDiagnostic,
    });
    expect(omission?.context).toMatchObject(expectedHtmlDiagnostic);
    expect(completedRun?.context).toMatchObject({
      providerRequestCount: 3,
      batchRequestCount: 1,
      compensationRequestCount: 2,
      providerRequestSuccessCount: 2,
      providerRequestFailureCount: 1,
      missingSegmentCount: 2,
      unresolvedMissingSegmentCount: 0,
    });
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain(outputCanary);
    expect(serialized).not.toContain('<source-segments-ndjson>');
  });

  it('recovers a synthetic seven-slot element-loss segment with one text-slot compensation', async () => {
    const complexSourceHtml = '<p>alpha <strong>beta</strong> three <a href="https://example.test/fixed" title="fixed">four</a> five <em>six</em> seven</p>';
    const batchPrompts: BatchPromptSegment[][] = [];
    const textSlotPrompts: TextSlotPromptSlot[][] = [];
    const records: TranslationLogRecord[] = [];
    contentStore.upsert({
      entryId: 1,
      cleanedHtml: `<p>intro.</p>${complexSourceHtml}`,
      markdown: 'intro.\n\nsynthetic complex paragraph.',
      pipelineStatus: 'success',
    });
    const recoveringProvider: SummaryProvider = {
      async *stream(providerRequest): AsyncIterable<string> {
        providerRequest.onUsage?.({ inputTokens: 11, outputTokens: 7, totalTokens: 18 });
        providerRequest.onFinishReason?.('stop');
        if (providerRequest.prompt.includes('<text-slots-ndjson>')) {
          const slots = parseTextSlotPrompt(providerRequest.prompt);
          textSlotPrompts.push(slots);
          for (const [index, slot] of slots.entries()) {
            yield `${JSON.stringify({
              textSlotId: slot.textSlotId,
              translatedText: `slot-${index + 1}`,
              appliedTermIds: [],
            })}\n`;
          }
          return;
        }
        const segments = parseBatchPrompt(providerRequest.prompt);
        batchPrompts.push(segments);
        for (const segment of segments) {
          const output = toBatchOutput(segment);
          if (segment.sourceHtml.includes('https://example.test/fixed')) {
            output.translatedHtml = output.translatedHtml.replace(
              /<strong>.*?<\/strong>/,
              '',
            );
          }
          yield `${JSON.stringify(output)}\n`;
        }
      },
      testConnection: () => Promise.resolve(),
    };
    const recoveringService = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      new TranslationStore(database),
      recoveringProvider,
      undefined,
      undefined,
      undefined,
      undefined,
      createCapturingLogger(records),
      new UsageRecorder(usageStore),
    );
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

    const started = recoveringService.generate(request);
    await vi.waitFor(() => {
      expect(recoveringService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const state = recoveringService.getState(request);
    if (state.state !== 'succeeded') throw new Error('Expected recovered Translation.');
    const recoveredSegment = state.result.segments.find((segment) =>
      segment.sourceHtml.includes('https://example.test/fixed'));
    expect(recoveredSegment).toMatchObject({ status: 'succeeded' });
    expect(recoveredSegment?.translatedHtml).toContain('<strong>slot-2</strong>');
    expect(recoveredSegment?.translatedHtml).toContain('href="https://example.test/fixed"');
    expect(recoveredSegment?.translatedHtml).toContain('title="fixed"');
    expect(batchPrompts.map((segments) => segments.length)).toEqual([3]);
    expect(textSlotPrompts).toHaveLength(1);
    expect(textSlotPrompts[0]?.map((slot) => slot.textSlotId)).toEqual([
      'slot-0001',
      'slot-0002',
      'slot-0003',
      'slot-0004',
      'slot-0005',
      'slot-0006',
      'slot-0007',
    ]);

    const completedRun = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.runCompleted);
    expect(completedRun?.context).toMatchObject({
      providerRequestCount: 2,
      batchRequestCount: 1,
      compensationRequestCount: 1,
      providerRequestSuccessCount: 1,
      providerRequestFailureCount: 1,
      missingSegmentCount: 1,
      inputTokens: 22,
      outputTokens: 14,
      totalTokens: 36,
      unresolvedMissingSegmentCount: 0,
    });
    expect(usageStore.listByTask('translation', started.runId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestKind: 'batch', requestStatus: 'failed', inputTokens: 11 }),
      expect.objectContaining({ requestKind: 'compensation', requestStatus: 'succeeded', inputTokens: 11 }),
    ]));
  });

  it('escalates an omitted seven-slot segment to local DOM reconstruction when normal compensation changes its structure', async () => {
    const complexSourceHtml = '<p>alpha <strong>beta</strong> three <a href="https://example.test/fixed" title="fixed">four</a> five <em>six</em> seven</p>';
    const batchPrompts: BatchPromptSegment[][] = [];
    const textSlotPrompts: TextSlotPromptSlot[][] = [];
    const records: TranslationLogRecord[] = [];
    contentStore.upsert({
      entryId: 1,
      cleanedHtml: `<p>intro.</p>${complexSourceHtml}`,
      markdown: 'intro.\n\nsynthetic complex paragraph.',
      pipelineStatus: 'success',
    });
    const recoveringProvider: SummaryProvider = {
      async *stream(providerRequest): AsyncIterable<string> {
        providerRequest.onFinishReason?.('stop');
        if (providerRequest.prompt.includes('<text-slots-ndjson>')) {
          const slots = parseTextSlotPrompt(providerRequest.prompt);
          textSlotPrompts.push(slots);
          for (const [index, slot] of slots.entries()) {
            yield `${JSON.stringify({
              textSlotId: slot.textSlotId,
              translatedText: `slot-${index + 1}`,
              appliedTermIds: [],
            })}\n`;
          }
          return;
        }

        const segments = parseBatchPrompt(providerRequest.prompt);
        batchPrompts.push(segments);
        for (const segment of segments) {
          if (
            segments.length > 1
            && segment.sourceHtml.includes('https://example.test/fixed')
          ) {
            continue;
          }
          const output = toBatchOutput(segment);
          if (segment.sourceHtml.includes('https://example.test/fixed')) {
            output.translatedHtml = output.translatedHtml.replace(
              /<strong>.*?<\/strong>/,
              '',
            );
          }
          yield `${JSON.stringify(output)}\n`;
        }
      },
      testConnection: () => Promise.resolve(),
    };
    const recoveringService = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      new TranslationStore(database),
      recoveringProvider,
      undefined,
      undefined,
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

    recoveringService.generate(request);
    await vi.waitFor(() => {
      expect(recoveringService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const state = recoveringService.getState(request);
    if (state.state !== 'succeeded') throw new Error('Expected recovered Translation.');
    const recoveredSegment = state.result.segments.find((segment) =>
      segment.sourceHtml.includes('https://example.test/fixed'));
    expect(recoveredSegment).toMatchObject({ status: 'succeeded' });
    expect(recoveredSegment?.translatedHtml).toContain('<strong>slot-2</strong>');
    expect(recoveredSegment?.translatedHtml).toContain('href="https://example.test/fixed"');
    expect(recoveredSegment?.translatedHtml).toContain('title="fixed"');
    expect(batchPrompts.map((segments) => segments.length)).toEqual([3, 1]);
    expect(textSlotPrompts).toHaveLength(1);
    expect(textSlotPrompts[0]?.map((slot) => slot.textSlotId)).toEqual([
      'slot-0001',
      'slot-0002',
      'slot-0003',
      'slot-0004',
      'slot-0005',
      'slot-0006',
      'slot-0007',
    ]);

    const failedNormalCompensation = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.providerRequestFailed
      && (record.context as { requestKind?: unknown }).requestKind === 'compensation'
      && (record.context as { compensationProtocol?: unknown }).compensationProtocol === undefined);
    const completedRun = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.runCompleted);
    expect(failedNormalCompensation?.context).toMatchObject({
      errorCode: TRANSLATION_LOG_ERROR_CODES.invalidStructure,
      reasonCode: 'html_structure_invalid',
      validationStage: 'html-validation',
      htmlValidationReason: 'html_element_count_mismatch',
      requestKind: 'compensation',
    });
    expect(completedRun?.context).toMatchObject({
      providerRequestCount: 3,
      batchRequestCount: 1,
      compensationRequestCount: 2,
      providerRequestSuccessCount: 2,
      providerRequestFailureCount: 1,
      missingSegmentCount: 1,
      unresolvedMissingSegmentCount: 0,
      success: true,
    });
  });

  it('locally preserves a no-slot protected segment without another Provider request', async () => {
    const prompts: string[] = [];
    const records: TranslationLogRecord[] = [];
    contentStore.upsert({
      entryId: 1,
      cleanedHtml: '<p><code>FIXEDTOKEN</code></p>',
      markdown: 'FIXEDTOKEN',
      pipelineStatus: 'success',
    });
    const providerWithRejectedCode: SummaryProvider = {
      async *stream(providerRequest): AsyncIterable<string> {
        prompts.push(providerRequest.prompt);
        providerRequest.onUsage?.({ inputTokens: 5, outputTokens: 3, totalTokens: 8 });
        providerRequest.onFinishReason?.('stop');
        for (const segment of parseBatchPrompt(providerRequest.prompt)) {
          const output = toBatchOutput(segment);
          if (segment.sourceHtml.includes('FIXEDTOKEN')) {
            output.translatedHtml = output.translatedHtml.replace(
              /(<\/[A-Za-z][^>]*>)\s*$/,
              '<em>extra</em>$1',
            );
          }
          yield `${JSON.stringify(output)}\n`;
        }
      },
      testConnection: () => Promise.resolve(),
    };
    const recoveringService = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      new TranslationStore(database),
      providerWithRejectedCode,
      undefined,
      undefined,
      undefined,
      undefined,
      createCapturingLogger(records),
      new UsageRecorder(usageStore),
    );
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

    const started = recoveringService.generate(request);
    await vi.waitFor(() => {
      expect(recoveringService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const state = recoveringService.getState(request);
    if (state.state !== 'succeeded') throw new Error('Expected locally recovered Translation.');
    expect(state.result.segments.find((segment) => segment.sourceHtml.includes('FIXEDTOKEN')))
      .toMatchObject({ translatedHtml: '<p><code>FIXEDTOKEN</code></p>' });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain('<text-slots-ndjson>');
    expect(records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.runCompleted)?.context).toMatchObject({
      providerRequestCount: 1,
      compensationRequestCount: 0,
    });
    expect(usageStore.listByTask('translation', started.runId)).toHaveLength(1);
  });

  it.each([
    ['missing', 'expected_text_slot_missing'],
    ['duplicate', 'text_slot_id_duplicate'],
    ['unexpected', 'text_slot_id_unexpected'],
    ['malformed', 'ndjson_syntax_error'],
    ['empty', 'translated_text_empty'],
  ] as const)('rejects a %s text-slot compensation without persisting an incomplete segment', async (
    responseKind,
    reasonCode,
  ) => {
    const sourceCanary = `SYNTHETIC_TEXT_SLOT_${responseKind.toUpperCase()}`;
    const records: TranslationLogRecord[] = [];
    contentStore.upsert({
      entryId: 1,
      cleanedHtml: `<p>${sourceCanary}</p>`,
      markdown: sourceCanary,
      pipelineStatus: 'success',
    });
    const rejectingProvider: SummaryProvider = {
      async *stream(providerRequest): AsyncIterable<string> {
        providerRequest.onUsage?.({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
        providerRequest.onFinishReason?.('stop');
        if (!providerRequest.prompt.includes('<text-slots-ndjson>')) {
          const segments = parseBatchPrompt(providerRequest.prompt);
          for (const segment of segments) {
            const output = toBatchOutput(segment);
            if (segment.sourceHtml.includes(sourceCanary)) {
              output.translatedHtml = output.translatedHtml.replace(
                /(<\/[A-Za-z][^>]*>)\s*$/,
                '<em>extra</em>$1',
              );
            }
            yield `${JSON.stringify(output)}\n`;
          }
          return;
        }

        const slot = parseTextSlotPrompt(providerRequest.prompt)[0];
        if (!slot) throw new Error('Expected one text slot.');
        if (responseKind === 'missing') return;
        if (responseKind === 'malformed') {
          yield 'not-json\n';
          return;
        }
        if (responseKind === 'empty') {
          yield `${JSON.stringify({
            textSlotId: slot.textSlotId,
            translatedText: ' ',
            appliedTermIds: [],
          })}\n`;
          return;
        }
        if (responseKind === 'unexpected') {
          yield `${JSON.stringify({
            textSlotId: 'slot-9999',
            translatedText: 'wrong',
            appliedTermIds: [],
          })}\n`;
          return;
        }
        yield `${JSON.stringify({
          textSlotId: slot.textSlotId,
          translatedText: 'first',
          appliedTermIds: [],
        })}\n`;
        yield `${JSON.stringify({
          textSlotId: slot.textSlotId,
          translatedText: 'duplicate',
          appliedTermIds: [],
        })}\n`;
      },
      testConnection: () => Promise.resolve(),
    };
    const rejectingService = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      new TranslationStore(database),
      rejectingProvider,
      undefined,
      undefined,
      undefined,
      undefined,
      createCapturingLogger(records),
      new UsageRecorder(usageStore),
    );
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

    const started = rejectingService.generate(request);
    await vi.waitFor(() => {
      expect(rejectingService.getState(request)).toMatchObject({ state: 'failed' });
    });

    const state = rejectingService.getState(request);
    if (state.state !== 'failed') throw new Error('Expected a failed Translation.');
    const failedSegment = state.result.segments.find((segment) =>
      segment.sourceHtml.includes(sourceCanary));
    expect(failedSegment).toMatchObject({ status: 'failed' });
    expect(failedSegment?.translatedHtml).toBeUndefined();
    const failedCompensation = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.providerRequestFailed
      && (record.context as { compensationProtocol?: unknown }).compensationProtocol === 'text-slots');
    expect(failedCompensation?.context).toMatchObject({
      requestKind: 'compensation',
      compensationProtocol: 'text-slots',
      reasonCode,
      expectedTextSlotCount: 1,
      expectedSegmentCount: 1,
      acceptedSegmentCount: 0,
      missingSegmentCount: 1,
    });
    expect(usageStore.listByTask('translation', started.runId)).toHaveLength(2);
    expect(JSON.stringify(records)).not.toContain(sourceCanary);
  });

  it('records a Provider length truncation separately and only compensates the original missing segments', async () => {
    const prompts: BatchPromptSegment[][] = [];
    const records: TranslationLogRecord[] = [];
    const truncatedProvider: SummaryProvider = {
      async *stream(providerRequest): AsyncIterable<string> {
        const segments = parseBatchPrompt(providerRequest.prompt);
        prompts.push(segments);
        if (segments.length > 1) {
          providerRequest.onFinishReason?.('length');
          yield '{"sourceSegmentId":"truncated';
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
      truncatedProvider,
      undefined,
      undefined,
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

    recoveringService.generate(request);
    await vi.waitFor(() => {
      expect(recoveringService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    expect(prompts.map((segments) => segments.length)).toEqual([3, 1, 1, 1]);
    const truncatedBatch = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.providerRequestFailed
      && (record.context as { requestKind?: unknown }).requestKind === 'batch');
    expect(truncatedBatch?.context).toMatchObject({
      reasonCode: 'provider_length_truncated',
      validationStage: 'stream',
      finishReason: 'length',
      expectedSegmentCount: 3,
      parsedSegmentCount: 0,
      acceptedSegmentCount: 0,
      missingSegmentCount: 3,
      malformedRecordCount: 0,
    });
  });

  it('hashes an unexpected compensation ID, does not recurse, and does not log model content', async () => {
    const unexpectedId = 'model-returned-unexpected-segment';
    const outputCanary = 'RAW_PROVIDER_OUTPUT_CANARY';
    const prompts: BatchPromptSegment[][] = [];
    const records: TranslationLogRecord[] = [];
    const invalidCompensationProvider: SummaryProvider = {
      async *stream(providerRequest): AsyncIterable<string> {
        const segments = parseBatchPrompt(providerRequest.prompt);
        prompts.push(segments);
        if (segments.length > 1) {
          for (const segment of segments.slice(0, -1)) {
            yield `${JSON.stringify(toBatchOutput(segment))}\n`;
          }
          return;
        }
        const segment = segments[0];
        if (!segment) throw new Error('Expected a compensation segment.');
        yield `${JSON.stringify({
          ...toBatchOutput(segment),
          sourceSegmentId: unexpectedId,
          translatedHtml: `<p>${outputCanary}</p>`,
        })}\n`;
      },
      testConnection: () => Promise.resolve(),
    };
    const invalidService = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      new TranslationStore(database),
      invalidCompensationProvider,
      undefined,
      undefined,
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

    invalidService.generate(request);
    await vi.waitFor(() => {
      expect(invalidService.getState(request)).toMatchObject({ state: 'failed' });
    });

    expect(prompts.map((segments) => segments.length)).toEqual([3, 1]);
    const failedCompensation = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.providerRequestFailed
      && (record.context as { requestKind?: unknown }).requestKind === 'compensation');
    expect(failedCompensation?.context).toMatchObject({
      errorCode: TRANSLATION_LOG_ERROR_CODES.invalidStructure,
      reasonCode: 'segment_id_unexpected',
      validationStage: 'segment-id',
      expectedSegmentCount: 1,
      parsedSegmentCount: 1,
      acceptedSegmentCount: 0,
      missingSegmentCount: 1,
      duplicateSegmentCount: 0,
      unexpectedSegmentCount: 1,
      affectedSegmentIdHashes: expect.arrayContaining([
        expect.stringMatching(/^[a-f0-9]{16}$/),
      ]),
    });
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain(unexpectedId);
    expect(serialized).not.toContain(outputCanary);
    expect(serialized).not.toContain('<source-segments-ndjson>');
  });

  it('classifies a duplicate segment ID without adding compensation retries', async () => {
    const prompts: BatchPromptSegment[][] = [];
    const records: TranslationLogRecord[] = [];
    const duplicateIdProvider: SummaryProvider = {
      async *stream(providerRequest): AsyncIterable<string> {
        const segments = parseBatchPrompt(providerRequest.prompt);
        prompts.push(segments);
        if (segments.length > 1) {
          const first = segments[0];
          if (!first) throw new Error('Expected a batch segment.');
          yield `${JSON.stringify(toBatchOutput(first))}\n`;
          yield `${JSON.stringify(toBatchOutput(first))}\n`;
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
      duplicateIdProvider,
      undefined,
      undefined,
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

    recoveringService.generate(request);
    await vi.waitFor(() => {
      expect(recoveringService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    expect(prompts.map((segments) => segments.length)).toEqual([3, 1, 1]);
    const duplicateBatch = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.providerRequestFailed
      && (record.context as { requestKind?: unknown }).requestKind === 'batch');
    expect(duplicateBatch?.context).toMatchObject({
      reasonCode: 'segment_id_duplicate',
      validationStage: 'segment-id',
      expectedSegmentCount: 3,
      parsedSegmentCount: 2,
      acceptedSegmentCount: 1,
      missingSegmentCount: 2,
      duplicateSegmentCount: 1,
      unexpectedSegmentCount: 0,
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
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

    recoveringService.generate(request);
    await vi.waitFor(() => {
      expect(recoveringService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const completedRun = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.runCompleted);
    const emptyBatch = records.find((record) =>
      record.event === TRANSLATION_LOG_EVENTS.providerRequestFailed
      && (record.context as { requestKind?: unknown }).requestKind === 'batch');
    expect(prompts.map((segments) => segments.length)).toEqual([3, 1, 1, 1]);
    expect(emptyBatch?.context).toMatchObject({
      reasonCode: 'response_empty',
      validationStage: 'stream',
      expectedSegmentCount: 3,
      parsedSegmentCount: 0,
      acceptedSegmentCount: 0,
      missingSegmentCount: 3,
      malformedRecordCount: 0,
      emptyTranslationCount: 1,
    });
    expect(completedRun?.context).toMatchObject({
      providerRequestCount: 4,
      batchRequestCount: 1,
      compensationRequestCount: 3,
      providerRequestSuccessCount: 3,
      providerRequestFailureCount: 1,
      missingSegmentCount: 3,
      unresolvedMissingSegmentCount: 0,
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
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };
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
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

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
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };
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
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

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
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'en' as const };
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
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'en' as const };
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
      providerKind: 'openai',
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
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

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
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

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
      providerKind: 'openai',
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
      undefined,
      undefined,
      createCapturingLogger(records),
      new UsageRecorder(new UsageStore(db)),
    );
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };
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
    expect(records.filter((record) => record.event === TRANSLATION_LOG_EVENTS.runStarted))
      .toEqual([
        expect.objectContaining({
          context: expect.objectContaining({
            taskRunId: firstRun.runId,
            trigger: 'initial',
          }),
        }),
        expect.objectContaining({
          context: expect.objectContaining({
            taskRunId: firstRun.runId,
            trigger: 'resume',
          }),
        }),
      ]);
    const usageAttempts = new UsageStore(db).listByTask('translation', firstRun.runId);
    expect(usageAttempts).toHaveLength(2);
    expect(new Set(usageAttempts.map((event) => event.attemptId)).size).toBe(2);
  });

  it('does not compensate a mapped provider timeout and preserves the incomplete run', async () => {
    const { db } = buildTestDbWithData();
    const content = new ContentStore(db);
    content.upsert({ entryId: 1, cleanedHtml: '<p>Article paragraph.</p>', pipelineStatus: 'success' });
    const profiles = new ProviderProfileStore(db);
    profiles.saveActive({
      providerKind: 'openai',
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
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

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
        context: {
          taskRunId: failedState.result.id,
          trigger: 'initial',
          previousResultAtStart: 'none',
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
          expectedSegmentCount: 2,
          parsedSegmentCount: 0,
          acceptedSegmentCount: 0,
          missingSegmentCount: 2,
          duplicateSegmentCount: 0,
          unexpectedSegmentCount: 0,
          malformedRecordCount: 0,
          emptyTranslationCount: 0,
          inputCharacters: expect.any(Number),
          outputCharacters: 0,
          affectedSegmentIdHashes: expect.arrayContaining([
            expect.stringMatching(/^[a-f0-9]{16}$/),
          ]),
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
          unresolvedMissingSegmentCount: 0,
          trigger: 'initial',
          previousResultOutcome: 'none',
        },
      },
    ]);
  });

  it('analyzes smart context, composes expert guidance, and keeps output rules authoritative', async () => {
    const { db } = buildTestDbWithData();
    const content = new ContentStore(db);
    content.upsert({
      entryId: 1,
      cleanedHtml: '<p>A runtime executes application code.</p>',
      pipelineStatus: 'success',
    });
    const profiles = new ProviderProfileStore(db);
    profiles.saveActive({
      providerKind: 'openai',
      baseUrl: 'https://provider.example/v1',
      model: 'mock-model',
      apiKeyRef: 'key-context-expert',
    });
    memorySecrets.set('key-context-expert', 'not-a-real-key');
    const prompts: string[] = [];
    const adaptiveProvider: SummaryProvider = {
      async *stream(request): AsyncIterable<string> {
        prompts.push(request.prompt);
        if (request.prompt.startsWith('Analyze untrusted article content')) {
          yield JSON.stringify({
            schemaVersion: 1,
            detectedSourceLanguage: 'en',
            theme: 'Software runtime architecture.',
            keyTerms: [{
              source: 'runtime',
              suggestedTarget: '运行时',
              meaning: 'An execution environment.',
            }],
            styleGuide: ['Use concise technical prose.'],
          });
          return;
        }
        for (const segment of parseBatchPrompt(request.prompt)) {
          yield `${JSON.stringify(toBatchOutput(segment))}\n`;
        }
      },
      testConnection: () => Promise.resolve(),
    };
    const expertService = new TranslationExpertService(new TranslationExpertStore(
      db,
      builtInExpertBundle as BuiltInExpertBundle,
    ));
    const contextService = new TranslationContextService(
      new TranslationContextStore(db),
      adaptiveProvider,
    );
    const advancedService = new TranslationService(
      content,
      profiles,
      new TestSecretStore(),
      new TranslationStore(db),
      adaptiveProvider,
      undefined,
      undefined,
      expertService,
      contextService,
    );
    const request = {
      entryId: 1,
      sourceLanguage: 'en' as const,
      targetLanguage: 'zh-CN' as const,
      expertId: 'tech',
      useSmartContext: true,
    };

    advancedService.generate(request);
    await vi.waitFor(() => {
      expect(advancedService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const translatedPrompt = prompts.find((prompt) => prompt.includes('<source-segments-ndjson>'));
    expect(prompts.some((prompt) =>
      prompt.startsWith('Analyze untrusted article content'))).toBe(true);
    expect(translatedPrompt).toContain('<domain-expert-guidance>');
    expect(translatedPrompt).toContain('specialized in technology content');
    expect(translatedPrompt).toContain('<trusted-article-context>');
    expect(translatedPrompt).toContain('Software runtime architecture');
    expect(translatedPrompt?.indexOf('Return NDJSON only'))
      .toBeLessThan(translatedPrompt?.indexOf('<domain-expert-guidance>') ?? 0);
    expect(advancedService.getState(request)).toMatchObject({
      result: {
        expertId: 'tech',
        smartContextEnabled: true,
        contextWarning: undefined,
      },
    });
  });

  it('continues translation with an observable warning when smart context fails', async () => {
    const { db } = buildTestDbWithData();
    const content = new ContentStore(db);
    content.upsert({
      entryId: 1,
      cleanedHtml: '<p>Fallback article.</p>',
      pipelineStatus: 'success',
    });
    const profiles = new ProviderProfileStore(db);
    profiles.saveActive({
      providerKind: 'openai',
      baseUrl: 'https://provider.example/v1',
      model: 'mock-model',
      apiKeyRef: 'key-context-fallback',
    });
    memorySecrets.set('key-context-fallback', 'not-a-real-key');
    const fallbackProvider: SummaryProvider = {
      async *stream(request): AsyncIterable<string> {
        if (request.prompt.startsWith('Analyze untrusted article content')) {
          yield 'invalid context';
          return;
        }
        for (const segment of parseBatchPrompt(request.prompt)) {
          yield `${JSON.stringify(toBatchOutput(segment))}\n`;
        }
      },
      testConnection: () => Promise.resolve(),
    };
    const records: TranslationLogRecord[] = [];
    const fallbackService = new TranslationService(
      content,
      profiles,
      new TestSecretStore(),
      new TranslationStore(db),
      fallbackProvider,
      undefined,
      undefined,
      undefined,
      new TranslationContextService(new TranslationContextStore(db), fallbackProvider),
      createCapturingLogger(records),
    );
    const request = {
      entryId: 1,
      sourceLanguage: 'en' as const,
      targetLanguage: 'fr' as const,
      useSmartContext: true,
    };

    fallbackService.generate(request);
    await vi.waitFor(() => {
      expect(fallbackService.getState(request)).toMatchObject({ state: 'succeeded' });
    });
    expect(fallbackService.getState(request)).toMatchObject({
      result: {
        smartContextEnabled: true,
        contextWarning: {
          code: 'TRANSLATION_CONTEXT_UNAVAILABLE',
          retryable: true,
        },
      },
    });
    expect(records.map((record) => record.event)).toEqual([
      TRANSLATION_LOG_EVENTS.runStarted,
      TRANSLATION_LOG_EVENTS.runCompleted,
    ]);
    expect(records[0]?.context).not.toHaveProperty('contextDegraded');
    expect(records[1]?.context).toMatchObject({
      contextDegraded: true,
      contextWarningCode: 'TRANSLATION_CONTEXT_UNAVAILABLE',
    });
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
      providerKind: 'openai',
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

    pendingService.generate({ entryId: 1, sourceLanguage: 'auto', targetLanguage: 'en' });
    expect(() => pendingService.generate({ entryId: 2, sourceLanguage: 'auto', targetLanguage: 'en' }))
      .toThrow('Another Translation is already being generated');
    pendingService.abortActiveRun();
  });

  it('pauses an active Translation and resumes only unfinished segments', async () => {
    contentStore.upsert({
      entryId: 1,
      cleanedHtml: [
        '<p>First article paragraph.</p>',
        '<p>Second article paragraph.</p>',
        '<p>Third article paragraph.</p>',
        '<p>Fourth article paragraph.</p>',
      ].join(''),
      markdown: [
        'First article paragraph.',
        'Second article paragraph.',
        'Third article paragraph.',
        'Fourth article paragraph.',
      ].join('\n\n'),
      pipelineStatus: 'success',
    });
    let resumeMode = false;
    let firstOutputEmitted = false;
    let activeInitialStreams = 0;
    const initialPrompts: BatchPromptSegment[][] = [];
    const resumedPrompts: BatchPromptSegment[][] = [];
    const pausableProvider: SummaryProvider = {
      async *stream(request): AsyncIterable<string> {
        const segments = parseBatchPrompt(request.prompt);
        (resumeMode ? resumedPrompts : initialPrompts).push(segments);
        if (resumeMode) {
          for (const segment of segments) {
            yield `${JSON.stringify(toBatchOutput(segment))}\n`;
          }
          return;
        }
        activeInitialStreams += 1;
        try {
          let emittedInitialOutput = false;
          if (!firstOutputEmitted) {
            firstOutputEmitted = true;
            const firstSegment = segments[0];
            if (firstSegment) {
              emittedInitialOutput = true;
              yield `${JSON.stringify(toBatchOutput(firstSegment))}\n`;
            }
          }
          if (!request.signal.aborted) {
            await new Promise<void>((resolve) => {
              request.signal.addEventListener('abort', () => resolve(), { once: true });
            });
          }
          const lateSegment = segments[emittedInitialOutput ? 1 : 0];
          if (lateSegment) {
            yield `${JSON.stringify(toBatchOutput(lateSegment))}\n`;
          }
        } finally {
          activeInitialStreams -= 1;
        }
      },
      testConnection: () => Promise.resolve(),
    };
    const records: TranslationLogRecord[] = [];
    const pauseService = new TranslationService(
      contentStore,
      profileStore,
      new TestSecretStore(),
      new TranslationStore(database),
      pausableProvider,
      undefined,
      undefined,
      undefined,
      undefined,
      createCapturingLogger(records),
    );
    const request = {
      entryId: 1,
      sourceLanguage: 'auto' as const,
      targetLanguage: 'zh-CN' as const,
    };
    const eventTypes: string[] = [];
    let completedBeforePause: string | undefined;
    let pauseAccepted = false;
    pauseService.subscribe((event) => {
      eventTypes.push(event.type);
      if (event.type !== 'segment-completed' || completedBeforePause) return;
      completedBeforePause = event.sourceSegmentId;
      pauseAccepted = pauseService.pause({
        ...request,
        runId: event.runId,
      }).paused;
    });

    const started = pauseService.generate(request);
    await vi.waitFor(() => {
      expect(pauseService.getState(request)).toMatchObject({ state: 'paused' });
    });

    const pausedState = pauseService.getState(request);
    expect(pauseAccepted).toBe(true);
    expect(eventTypes).toContain('paused');
    expect(pausedState).toMatchObject({
      state: 'paused',
      result: {
        id: started.runId,
        status: 'failed',
        error: {
          code: 'TRANSLATION_PAUSED',
          retryable: true,
        },
      },
    });
    if (pausedState.state !== 'paused' || !completedBeforePause) {
      throw new Error('Expected a paused Translation with one completed segment.');
    }
    const completedSegment = pausedState.result.segments.find((segment) =>
      segment.sourceSegmentId === completedBeforePause);
    expect(completedSegment).toMatchObject({
      status: 'succeeded',
      translatedText: 'Translated paragraph.',
    });
    const completedEventCount = eventTypes.filter((type) =>
      type === 'segment-completed').length;
    await vi.waitFor(() => {
      expect(activeInitialStreams).toBe(0);
    });
    expect(eventTypes.filter((type) => type === 'segment-completed')).toHaveLength(
      completedEventCount,
    );
    expect(records.map((record) => record.event)).toEqual([
      TRANSLATION_LOG_EVENTS.runStarted,
      TRANSLATION_LOG_EVENTS.runInterrupted,
    ]);
    expect(records[1]?.context).toMatchObject({
      stopReason: 'paused',
      trigger: 'initial',
      previousResultOutcome: 'none',
    });

    resumeMode = true;
    const resumed = pauseService.generate(request);
    expect(resumed).toMatchObject({
      runId: started.runId,
      reused: false,
      result: { status: 'running' },
    });
    await vi.waitFor(() => {
      expect(pauseService.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    expect(initialPrompts.length).toBeGreaterThan(0);
    expect(resumedPrompts.length).toBeGreaterThan(0);
    expect(resumedPrompts.flat().map((segment) => segment.sourceSegmentId))
      .not.toContain(completedBeforePause);
    expect(records.map((record) => record.event)).toEqual([
      TRANSLATION_LOG_EVENTS.runStarted,
      TRANSLATION_LOG_EVENTS.runInterrupted,
      TRANSLATION_LOG_EVENTS.runStarted,
      TRANSLATION_LOG_EVENTS.runCompleted,
    ]);
    expect(records[2]?.context).toMatchObject({
      taskRunId: started.runId,
      trigger: 'resume',
      previousResultAtStart: 'none',
    });
  });
});
