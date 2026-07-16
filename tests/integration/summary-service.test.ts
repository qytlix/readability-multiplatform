import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockSummaryProvider } from '../../src/main/ai/MockSummaryProvider';
import { ProviderProfileStore } from '../../src/main/ai/ProviderProfileStore';
import { SecretStore, type SafeStorageBackend } from '../../src/main/ai/SecretStore';
import { SummaryService } from '../../src/main/ai/SummaryService';
import { SummaryStore } from '../../src/main/ai/SummaryStore';
import type { SummaryProvider, SummaryProviderRequest } from '../../src/main/ai/SummaryProvider';
import { ContentStore } from '../../src/main/feed/ContentStore';
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
    super('/tmp/unused-summary-secrets.json', fakeSafeStorage, 'linux');
  }

  override save(reference: string, apiKey: string): void {
    memorySecrets.set(reference, apiKey);
  }

  override read(reference: string): string {
    const key = memorySecrets.get(reference);
    if (!key) throw new Error('Missing key');
    return key;
  }
}

describe('SummaryService', () => {
  let contentStore: ContentStore;
  let service: SummaryService;
  let provider: MockSummaryProvider;

  beforeEach(() => {
    memorySecrets.clear();
    const { db } = buildTestDbWithData();
    contentStore = new ContentStore(db);
    contentStore.upsert({
      entryId: 1,
      markdown: 'A persisted article about reliable local software.',
      pipelineStatus: 'success',
    });
    const profiles = new ProviderProfileStore(db);
    const savedProfile = profiles.saveActive({
      baseUrl: 'https://provider.example/v1',
      model: 'mock-model',
      apiKeyRef: 'key-1',
    });
    memorySecrets.set('key-1', 'not-a-real-key');
    provider = new MockSummaryProvider(['Local ', 'summary.']);
    service = new SummaryService(
      contentStore,
      profiles,
      new TestSecretStore(),
      new SummaryStore(db),
      provider,
    );
    expect(savedProfile.id).toBeGreaterThan(0);
  });

  it('streams, persists, and reuses a fresh summary without another provider call', async () => {
    const events: string[] = [];
    service.subscribe((event) => events.push(event.type));
    const stream = vi.spyOn(provider, 'stream');
    const request = { entryId: 1, targetLanguage: 'en' as const, detailLevel: 'medium' as const };

    const started = service.generate(request);
    expect(started.reused).toBe(false);
    await vi.waitFor(() => {
      expect(service.getState(request)).toMatchObject({
        state: 'succeeded',
        freshness: 'fresh',
      });
    });

    const state = service.getState(request);
    expect(state).toMatchObject({ state: 'succeeded' });
    expect(events).toEqual(['started', 'delta', 'delta', 'completed']);

    const cached = service.generate(request);
    expect(cached).toEqual({ runId: started.runId, reused: true });
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('marks a saved result stale when the cleaned Markdown changes', async () => {
    const request = { entryId: 1, targetLanguage: 'zh-CN' as const, detailLevel: 'short' as const };
    service.generate(request);
    await vi.waitFor(() => {
      expect(service.getState(request)).toMatchObject({ state: 'succeeded' });
    });

    contentStore.upsert({
      entryId: 1,
      markdown: 'This is a changed version of the article.',
      pipelineStatus: 'success',
    });

    expect(service.getState(request)).toMatchObject({
      state: 'succeeded',
      freshness: 'stale',
    });
  });

  it('rejects a Summary when successful cleaned Markdown is unavailable', () => {
    expect(() => service.generate({
      entryId: 2,
      targetLanguage: 'en',
      detailLevel: 'medium',
    })).toThrow('cleaned article Markdown');
  });

  it('permits only one active Summary run globally', () => {
    const { db } = buildTestDbWithData();
    const content = new ContentStore(db);
    content.upsert({ entryId: 1, markdown: 'First article.', pipelineStatus: 'success' });
    content.upsert({ entryId: 2, markdown: 'Second article.', pipelineStatus: 'success' });
    const profiles = new ProviderProfileStore(db);
    profiles.saveActive({
      baseUrl: 'https://provider.example/v1',
      model: 'mock-model',
      apiKeyRef: 'key-2',
    });
    memorySecrets.set('key-2', 'not-a-real-key');
    const pendingProvider: SummaryProvider = {
      async *stream(providerRequest: SummaryProviderRequest): AsyncIterable<string> {
        await new Promise<void>((resolve) => {
          providerRequest.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        if (providerRequest.signal.aborted) return;
        yield 'unreachable';
      },
      testConnection: () => Promise.resolve(),
    };
    const pendingService = new SummaryService(
      content,
      profiles,
      new TestSecretStore(),
      new SummaryStore(db),
      pendingProvider,
    );

    pendingService.generate({ entryId: 1, targetLanguage: 'en', detailLevel: 'short' });
    expect(() => pendingService.generate({
      entryId: 2,
      targetLanguage: 'en',
      detailLevel: 'short',
    })).toThrow('Another Summary is already being generated');
    pendingService.abortActiveRun();
  });
});
