import { describe, expect, it, vi } from 'vitest';
import type {
  SummaryProvider,
  SummaryProviderRequest,
} from '../../../src/main/ai/provider/SummaryProvider';
import type { ProviderTokenUsage } from '../../../src/main/ai/provider/ProviderTokenUsage';
import {
  buildTranslationContextIdentity,
  buildTranslationProviderRuntimeIdentity,
  TranslationContextService,
} from '../../../src/main/ai/services/TranslationContextService';
import { UsageRecorder } from '../../../src/main/ai/services/UsageRecorder';
import { UsageStatisticsService } from '../../../src/main/ai/services/UsageStatisticsService';
import { ProviderProfileStore } from '../../../src/main/ai/stores/ProviderProfileStore';
import { TranslationContextStore } from '../../../src/main/ai/stores/TranslationContextStore';
import { UsageStore } from '../../../src/main/ai/stores/UsageStore';
import { buildTestDb } from '../../fixtures/databases/feed-fixture';

const CONTEXT_JSON = JSON.stringify({
  schemaVersion: 1,
  detectedSourceLanguage: 'en',
  theme: 'A software architecture article.',
  keyTerms: [{
    source: 'runtime',
    suggestedTarget: '运行时',
    meaning: 'The execution environment.',
  }],
  styleGuide: ['Use concise technical prose.'],
});

class ContextProvider implements SummaryProvider {
  readonly prompts: string[] = [];

  constructor(
    private readonly output = CONTEXT_JSON,
    private readonly usage?: ProviderTokenUsage,
  ) {}

  async *stream(request: SummaryProviderRequest): AsyncIterable<string> {
    this.prompts.push(request.prompt);
    if (this.usage) request.onUsage?.(this.usage);
    yield this.output;
  }

  testConnection(): Promise<void> {
    return Promise.resolve();
  }
}

function createRequest(profileId: number, articleText = 'An article about runtimes.') {
  return {
    identity: buildTranslationContextIdentity({
      sourceContentHash: 'content-hash',
      sourceLanguage: 'en' as const,
      targetLanguage: 'zh-CN' as const,
      providerProfileId: profileId,
      providerModel: 'mock-model',
      providerRuntimeIdentity: 'test-provider-runtime',
      expertId: 'none',
      expertContentHash: 'none',
    }),
    sourceLanguage: 'en' as const,
    targetLanguage: 'zh-CN' as const,
    articleText,
    provider: {
      kind: 'openai' as const,
      baseUrl: 'https://provider.example/v1',
      model: 'mock-model',
      apiKey: 'not-a-real-key',
    },
    usage: {
      attemptId: 'translation-attempt',
      taskRunId: 71,
    },
    signal: new AbortController().signal,
  };
}

describe('TranslationContextService', () => {
  it('analyzes once and reuses a successful context cache', async () => {
    const { db } = buildTestDb();
    const profileId = new ProviderProfileStore(db).saveActive({
      providerKind: 'openai',
      baseUrl: 'https://provider.example/v1',
      model: 'mock-model',
      apiKeyRef: 'key',
    }).id;
    const provider = new ContextProvider(CONTEXT_JSON, {
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
    });
    const usageStore = new UsageStore(db);
    const service = new TranslationContextService(
      new TranslationContextStore(db),
      provider,
      new UsageRecorder(usageStore),
    );

    const first = await service.resolve(createRequest(profileId));
    const second = await service.resolve(createRequest(profileId));

    expect(first).toMatchObject({ reused: false, context: { schemaVersion: 1 } });
    expect(second).toMatchObject({ reused: true, context: { theme: expect.any(String) } });
    expect(provider.prompts).toHaveLength(1);
    expect(provider.prompts[0]).toContain('<untrusted-article-chunk>');
    expect(usageStore.listByTask('translation', 71)).toEqual([
      expect.objectContaining({
        attemptId: 'translation-attempt',
        requestKind: 'context-chunk',
        requestStatus: 'succeeded',
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18,
        usageAvailability: 'reported',
      }),
    ]);
  });

  it('uses deterministic chunk analysis followed by a merge for long articles', async () => {
    const { db } = buildTestDb();
    const profileId = new ProviderProfileStore(db).saveActive({
      providerKind: 'openai',
      baseUrl: 'https://provider.example/v1',
      model: 'mock-model',
      apiKeyRef: 'key',
    }).id;
    const provider = new ContextProvider();
    const usageStore = new UsageStore(db);
    const service = new TranslationContextService(
      new TranslationContextStore(db),
      provider,
      new UsageRecorder(usageStore),
    );

    const outcome = await service.resolve(createRequest(profileId, 'A'.repeat(12_100)));

    expect(outcome.context?.theme).toContain('software architecture');
    expect(provider.prompts).toHaveLength(4);
    expect(provider.prompts.slice(0, 3).every((prompt) =>
      prompt.includes('deterministic chunk'))).toBe(true);
    expect(provider.prompts[3]).toContain('Merge partial document analyses');
    const records = usageStore.listByTask('translation', 71);
    expect(records.map((record) => record.requestKind)).toEqual([
      'context-chunk',
      'context-chunk',
      'context-chunk',
      'context-merge',
    ]);
    expect(new Set(records.map((record) => record.providerRequestId)).size).toBe(4);
    expect(records.every((record) =>
      record.attemptId === 'translation-attempt'
      && record.taskRunId === 71
      && record.usageAvailability === 'missing')).toBe(true);
    expect(new UsageStatisticsService(usageStore).getStatistics({
      startAt: '2020-01-01T00:00:00.000Z',
      endAt: '2100-01-01T00:00:00.000Z',
      timeZone: 'UTC',
      taskType: 'translation',
    }).totals).toMatchObject({
      requestCount: 4,
      tokenTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      tokenCoverage: { missingRequests: 4 },
    });
  });

  it('samples the beginning, middle regions, and end of an oversized article', async () => {
    const { db } = buildTestDb();
    const profileId = new ProviderProfileStore(db).saveActive({
      providerKind: 'openai',
      baseUrl: 'https://provider.example/v1',
      model: 'mock-model',
      apiKeyRef: 'key',
    }).id;
    const provider = new ContextProvider();
    const service = new TranslationContextService(new TranslationContextStore(db), provider);
    const articleText = [
      'DOCUMENT-BEGIN',
      'A'.repeat(59_980),
      'B'.repeat(59_980),
      'DOCUMENT-END',
    ].join('\n');

    await service.resolve(createRequest(profileId, articleText));

    const analysisPrompts = provider.prompts.slice(0, -1);
    expect(analysisPrompts).toHaveLength(8);
    expect(analysisPrompts[0]).toContain('DOCUMENT-BEGIN');
    expect(analysisPrompts.at(-1)).toContain('DOCUMENT-END');
    expect(analysisPrompts.slice(1, -1).some((prompt) =>
      prompt.includes('B'.repeat(100)))).toBe(true);
    expect(provider.prompts.at(-1)).toContain('Merge partial document analyses');
  });

  it('returns a non-fatal warning and does not cache invalid model output', async () => {
    const { db } = buildTestDb();
    const profileId = new ProviderProfileStore(db).saveActive({
      providerKind: 'openai',
      baseUrl: 'https://provider.example/v1',
      model: 'mock-model',
      apiKeyRef: 'key',
    }).id;
    const provider = new ContextProvider('not JSON');
    const usageStore = new UsageStore(db);
    const service = new TranslationContextService(
      new TranslationContextStore(db),
      provider,
      new UsageRecorder(usageStore),
    );
    const request = createRequest(profileId);

    const first = await service.resolve(request);
    const second = await service.resolve(request);

    expect(first).toMatchObject({
      reused: false,
      warning: { code: 'TRANSLATION_CONTEXT_UNAVAILABLE', retryable: true },
    });
    expect(first.context).toBeUndefined();
    expect(second.reused).toBe(false);
    expect(provider.prompts).toHaveLength(2);
    expect(usageStore.listByTask('translation', 71)).toEqual([
      expect.objectContaining({
        requestKind: 'context-chunk',
        requestStatus: 'failed',
        usageAvailability: 'missing',
      }),
      expect.objectContaining({
        requestKind: 'context-chunk',
        requestStatus: 'failed',
        usageAvailability: 'missing',
      }),
    ]);
  });

  it('includes provider model and expert hash in cache identity', () => {
    const base = buildTranslationContextIdentity({
      sourceContentHash: 'hash',
      sourceLanguage: 'en',
      targetLanguage: 'fr',
      providerProfileId: 1,
      providerModel: 'model-a',
      providerRuntimeIdentity: 'runtime-a',
      expertId: 'paper',
      expertContentHash: 'expert-a',
    });
    expect({
      modelChanged: { ...base, providerModel: 'model-b' },
      expertChanged: { ...base, expertContentHash: 'expert-b' },
    }).not.toEqual({
      modelChanged: base,
      expertChanged: base,
    });
  });

  it('scopes cached contexts to the normalized Provider runtime without persisting key material', async () => {
    const { db } = buildTestDb();
    const profileId = new ProviderProfileStore(db).saveActive({
      providerKind: 'openai',
      baseUrl: 'https://provider.example/v1',
      model: 'mock-model',
      apiKeyRef: 'opaque-credential-one',
    }).id;
    const provider = new ContextProvider();
    const usageStore = new UsageStore(db);
    const service = new TranslationContextService(
      new TranslationContextStore(db),
      provider,
      new UsageRecorder(usageStore),
    );
    const apiKeyCanary = 'context-runtime-api-key-must-not-persist';
    const createRuntimeRequest = (params: {
      kind: 'openai' | 'anthropic';
      baseUrl: string;
      credentialReference: string;
    }) => {
      const request = createRequest(profileId);
      return {
        ...request,
        identity: {
          ...request.identity,
          providerRuntimeIdentity: buildTranslationProviderRuntimeIdentity(params),
        },
        provider: {
          ...request.provider,
          kind: params.kind,
          baseUrl: params.baseUrl,
          apiKey: apiKeyCanary,
        },
      };
    };
    const original = createRuntimeRequest({
      kind: 'openai',
      baseUrl: 'HTTPS://PROVIDER.EXAMPLE:443/v1/',
      credentialReference: 'opaque-credential-one',
    });
    const equivalentEndpoint = createRuntimeRequest({
      kind: 'openai',
      baseUrl: 'https://provider.example/v1',
      credentialReference: 'opaque-credential-one',
    });
    const changedKind = createRuntimeRequest({
      kind: 'anthropic',
      baseUrl: 'https://provider.example/v1',
      credentialReference: 'opaque-credential-one',
    });
    const changedPath = createRuntimeRequest({
      kind: 'openai',
      baseUrl: 'https://provider.example/v2',
      credentialReference: 'opaque-credential-one',
    });
    const replacedCredential = createRuntimeRequest({
      kind: 'openai',
      baseUrl: 'https://provider.example/v1',
      credentialReference: 'opaque-credential-two',
    });

    expect(buildTranslationProviderRuntimeIdentity({
      kind: 'openai',
      baseUrl: 'https://other-provider.example/v1',
      credentialReference: 'opaque-credential-one',
    })).not.toBe(original.identity.providerRuntimeIdentity);
    expect(buildTranslationProviderRuntimeIdentity({
      kind: 'openai',
      baseUrl: 'https://provider.example:8443/v1',
      credentialReference: 'opaque-credential-one',
    })).not.toBe(original.identity.providerRuntimeIdentity);

    expect((await service.resolve(original)).reused).toBe(false);
    expect((await service.resolve(equivalentEndpoint)).reused).toBe(true);
    expect((await service.resolve(changedKind)).reused).toBe(false);
    expect((await service.resolve(changedPath)).reused).toBe(false);
    expect((await service.resolve(replacedCredential)).reused).toBe(false);
    expect((await service.resolve(original)).reused).toBe(true);

    const restarted = new TranslationContextService(
      new TranslationContextStore(db),
      provider,
      new UsageRecorder(usageStore),
    );
    expect((await restarted.resolve(original)).reused).toBe(true);
    expect(provider.prompts).toHaveLength(4);
    expect(usageStore.listByTask('translation', 71)).toHaveLength(4);
    const cachedRows = db.prepare(`
      SELECT providerRuntimeIdentity, contextJson FROM translation_context_cache
      ORDER BY id
    `).all();
    expect(cachedRows).toHaveLength(4);
    expect(JSON.stringify(cachedRows)).not.toContain(apiKeyCanary);
    expect(JSON.stringify(cachedRows)).not.toContain('Authorization');
  });

  it('propagates an explicit parent cancellation', async () => {
    const { db } = buildTestDb();
    const profileId = new ProviderProfileStore(db).saveActive({
      providerKind: 'openai',
      baseUrl: 'https://provider.example/v1',
      model: 'mock-model',
      apiKeyRef: 'key',
    }).id;
    const provider: SummaryProvider = {
      async *stream(request): AsyncIterable<string> {
        await new Promise<void>((resolve) => {
          request.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        if (!request.signal.aborted) yield 'unreachable';
        throw new Error('aborted');
      },
      testConnection: () => Promise.resolve(),
    };
    const service = new TranslationContextService(new TranslationContextStore(db), provider);
    const controller = new AbortController();
    const request = { ...createRequest(profileId), signal: controller.signal };
    const pending = service.resolve(request);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'TRANSLATION_INTERRUPTED' });
    vi.restoreAllMocks();
  });
});
