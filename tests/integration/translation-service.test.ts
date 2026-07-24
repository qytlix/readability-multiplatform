import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { MockSummaryProvider } from '../../src/main/ai/provider/MockSummaryProvider';
import { ProviderProfileStore } from '../../src/main/ai/stores/ProviderProfileStore';
import { SecretStore, type SafeStorageBackend } from '../../src/main/ai/stores/SecretStore';
import type { SummaryProvider, SummaryProviderRequest } from '../../src/main/ai/provider/SummaryProvider';
import { TranslationService } from '../../src/main/ai/services/TranslationService';
import { TranslationContextService } from '../../src/main/ai/services/TranslationContextService';
import { TranslationExpertService } from '../../src/main/ai/services/TranslationExpertService';
import { TranslationStore } from '../../src/main/ai/stores/TranslationStore';
import { TranslationContextStore } from '../../src/main/ai/stores/TranslationContextStore';
import { TranslationExpertStore } from '../../src/main/ai/stores/TranslationExpertStore';
import builtInExpertBundle from '../../resources/ai-experts/experts.json';
import type { BuiltInExpertBundle } from '../../src/shared/contracts/translation-expert.types';
import type { TerminologyLookup } from '../../src/main/ai/stores/TerminologyStore';
import { ContentStore } from '../../src/main/feed/stores/ContentStore';
import { SUMMARY_ERROR_CODES, SummaryError } from '../../src/shared/errors/summary.errors';
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

class BatchMockProvider implements SummaryProvider {
  readonly prompts: string[] = [];
  readonly providerKinds: Array<SummaryProviderRequest['providerKind']> = [];
  activeStreams = 0;
  maxActiveStreams = 0;

  async *stream(request: SummaryProviderRequest): AsyncIterable<string> {
    this.prompts.push(request.prompt);
    this.providerKinds.push(request.providerKind);
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
    const profiles = new ProviderProfileStore(db);
    profiles.saveActive({
      providerKind: 'openai',
      baseUrl: 'https://provider.example/v1',
      model: 'mock-model',
      apiKeyRef: 'key-1',
    });
    memorySecrets.set('key-1', 'not-a-real-key');
    provider = new BatchMockProvider();
    service = new TranslationService(
      contentStore,
      profiles,
      new TestSecretStore(),
      new TranslationStore(db),
      provider,
    );
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
    expect(provider.providerKinds).toEqual(['openai']);
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
      expect(diagnostics).toContain('[translation:timing]');
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
    const recoveringService = new TranslationService(
      content,
      profiles,
      new TestSecretStore(),
      new TranslationStore(db),
      omittingProvider,
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

  it('retries only unfinished segments while preserving completed output', async () => {
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
  });

  it('persists a mapped, retryable provider failure without discarding the run', async () => {
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
});
