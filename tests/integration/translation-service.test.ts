import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockSummaryProvider } from '../../src/main/ai/MockSummaryProvider';
import { ProviderProfileStore } from '../../src/main/ai/ProviderProfileStore';
import { SecretStore, type SafeStorageBackend } from '../../src/main/ai/SecretStore';
import type { SummaryProvider, SummaryProviderRequest } from '../../src/main/ai/SummaryProvider';
import { TranslationService } from '../../src/main/ai/TranslationService';
import { TranslationStore } from '../../src/main/ai/TranslationStore';
import { ContentStore } from '../../src/main/feed/ContentStore';
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

describe('TranslationService', () => {
  let contentStore: ContentStore;
  let provider: MockSummaryProvider;
  let service: TranslationService;

  beforeEach(() => {
    memorySecrets.clear();
    const { db } = buildTestDbWithData();
    contentStore = new ContentStore(db);
    contentStore.upsert({
      entryId: 1,
      cleanedHtml: '<p>First article paragraph.</p><p>Second article paragraph.</p>',
      markdown: 'First article paragraph.\n\nSecond article paragraph.',
      pipelineStatus: 'success',
    });
    const profiles = new ProviderProfileStore(db);
    profiles.saveActive({
      baseUrl: 'https://provider.example/v1',
      model: 'mock-model',
      apiKeyRef: 'key-1',
    });
    memorySecrets.set('key-1', 'not-a-real-key');
    provider = new MockSummaryProvider(['Translated ', 'paragraph.']);
    service = new TranslationService(
      contentStore,
      profiles,
      new TestSecretStore(),
      new TranslationStore(db),
      provider,
    );
  });

  it('serially streams, persists, and reuses a compatible Translation', async () => {
    const events: string[] = [];
    service.subscribe((event) => events.push(event.type));
    const stream = vi.spyOn(provider, 'stream');
    const request = { entryId: 1, targetLanguage: 'zh-CN' as const };

    const started = service.generate(request);
    await vi.waitFor(() => {
      expect(service.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    const state = service.getState(request);
    expect(state).toMatchObject({ state: 'succeeded' });
    if (state.state !== 'succeeded') throw new Error('Expected a completed Translation.');
    expect(state.result.segments.map((segment) => segment.translatedText)).toEqual([
      'Translated paragraph.',
      'Translated paragraph.',
    ]);
    expect(events).toEqual([
      'started',
      'segment-started',
      'segment-delta',
      'segment-delta',
      'segment-started',
      'segment-delta',
      'segment-delta',
      'completed',
    ]);

    expect(service.generate(request)).toEqual({ runId: started.runId, reused: true });
    expect(stream).toHaveBeenCalledTimes(2);
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

  it('persists a mapped, retryable provider failure without discarding the run', async () => {
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
    const request = { entryId: 1, targetLanguage: 'zh-CN' as const };

    failingService.generate(request);
    await vi.waitFor(() => {
      expect(failingService.getState(request)).toMatchObject({ state: 'failed' });
    });

    expect(failingService.getState(request)).toMatchObject({
      state: 'failed',
      result: {
        error: { code: 'TRANSLATION_PROVIDER_TIMEOUT', retryable: true },
        segments: [{ status: 'failed', error: { code: 'TRANSLATION_PROVIDER_TIMEOUT' } }],
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
