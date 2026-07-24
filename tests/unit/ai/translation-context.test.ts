import { describe, expect, it, vi } from 'vitest';
import type {
  SummaryProvider,
  SummaryProviderRequest,
} from '../../../src/main/ai/provider/SummaryProvider';
import {
  buildTranslationContextIdentity,
  TranslationContextService,
} from '../../../src/main/ai/services/TranslationContextService';
import { ProviderProfileStore } from '../../../src/main/ai/stores/ProviderProfileStore';
import { TranslationContextStore } from '../../../src/main/ai/stores/TranslationContextStore';
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

  constructor(private readonly output = CONTEXT_JSON) {}

  async *stream(request: SummaryProviderRequest): AsyncIterable<string> {
    this.prompts.push(request.prompt);
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
    const provider = new ContextProvider();
    const service = new TranslationContextService(new TranslationContextStore(db), provider);

    const first = await service.resolve(createRequest(profileId));
    const second = await service.resolve(createRequest(profileId));

    expect(first).toMatchObject({ reused: false, context: { schemaVersion: 1 } });
    expect(second).toMatchObject({ reused: true, context: { theme: expect.any(String) } });
    expect(provider.prompts).toHaveLength(1);
    expect(provider.prompts[0]).toContain('<untrusted-article-chunk>');
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
    const service = new TranslationContextService(new TranslationContextStore(db), provider);

    const outcome = await service.resolve(createRequest(profileId, 'A'.repeat(12_100)));

    expect(outcome.context?.theme).toContain('software architecture');
    expect(provider.prompts).toHaveLength(4);
    expect(provider.prompts.slice(0, 3).every((prompt) =>
      prompt.includes('deterministic chunk'))).toBe(true);
    expect(provider.prompts[3]).toContain('Merge partial document analyses');
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
    const service = new TranslationContextService(new TranslationContextStore(db), provider);
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
  });

  it('includes provider model and expert hash in cache identity', () => {
    const base = buildTranslationContextIdentity({
      sourceContentHash: 'hash',
      sourceLanguage: 'en',
      targetLanguage: 'fr',
      providerProfileId: 1,
      providerModel: 'model-a',
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
