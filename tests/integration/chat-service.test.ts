import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  TextGenerationProvider,
  TextGenerationProviderRequest,
} from '../../src/main/ai/provider/TextGenerationProvider';
import { ChatService } from '../../src/main/ai/services/ChatService';
import { ChatStore } from '../../src/main/ai/stores/ChatStore';
import { ProviderProfileStore } from '../../src/main/ai/stores/ProviderProfileStore';
import type { SecretStore } from '../../src/main/ai/stores/SecretStore';
import { ContentStore } from '../../src/main/feed/stores/ContentStore';
import { buildTestDbWithData } from '../fixtures/databases/feed-fixture';

describe('ChatService', () => {
  let requests: TextGenerationProviderRequest[];
  let answers: string[];

  beforeEach(() => {
    requests = [];
    answers = ['第一段', '，回答。'];
  });

  function createService(providerOverride?: TextGenerationProvider) {
    const { db } = buildTestDbWithData();
    const contentStore = new ContentStore(db);
    contentStore.upsert({
      entryId: 1,
      sourceUrl: 'https://example.com/post-1',
      cleanedHtml: '<article><p>本地优先软件可以减少云端依赖。</p></article>',
      markdown: '# 本地优先\n\n本地优先软件可以减少云端依赖。',
      pipelineStatus: 'success',
    });
    const profiles = new ProviderProfileStore(db);
    profiles.saveActive({
      summary: {
        providerKind: 'openai',
        baseUrl: 'https://summary.example/v1',
        model: 'summary-model',
        apiKeyRef: 'summary-key',
      },
      translation: {
        providerKind: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'translation-model',
        apiKeyRef: 'translation-key',
      },
      tag: {
        providerKind: 'openai',
        baseUrl: 'https://summary.example/v1',
        model: 'tag-model',
        apiKeyRef: 'summary-key',
      },
      chat: {
        providerKind: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'anthropic/claude-sonnet-4.5',
        apiKeyRef: 'chat-key',
      },
    });
    const provider: TextGenerationProvider = providerOverride ?? {
      async *stream(request) {
        requests.push(request);
        for (const answer of answers) yield answer;
      },
      testConnection: () => Promise.resolve(),
    };
    const secrets = {
      read: (reference: string) => {
        expect(reference).toBe('chat-key');
        return 'chat-secret';
      },
    } as SecretStore;
    return {
      contentStore,
      service: new ChatService(
        contentStore,
        profiles,
        secrets,
        new ChatStore(db),
        provider,
      ),
    };
  }

  it('streams and persists an article-grounded answer through the Chat route', async () => {
    const { service } = createService();
    const events: string[] = [];
    service.subscribe((event) => events.push(event.type));

    const started = service.send({ entryId: 1, question: '文章的核心观点是什么？' });
    await vi.waitFor(() => {
      expect(service.getState({ entryId: 1 }).messages).toHaveLength(2);
      expect(service.getState({ entryId: 1 }).messages[1]).toMatchObject({
        role: 'assistant',
        content: '第一段，回答。',
        status: 'succeeded',
      });
    });

    expect(started.runId).toBeGreaterThan(0);
    expect(events).toEqual(['started', 'delta', 'delta', 'completed']);
    expect(requests[0]).toMatchObject({
      providerKind: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-sonnet-4.5',
      apiKey: 'chat-secret',
      prompt: '',
      messages: [{ role: 'user', content: '文章的核心观点是什么？' }],
    });
    expect(requests[0]?.systemInstruction).toContain('本地优先软件可以减少云端依赖');
    expect(requests[0]?.systemInstruction).toContain('untrusted source material');
  });

  it('sends successful prior turns as ordered multi-turn history', async () => {
    const { service } = createService();
    service.send({ entryId: 1, question: '第一问？' });
    await vi.waitFor(() => {
      expect(service.getState({ entryId: 1 }).messages.at(-1)?.status).toBe('succeeded');
    });

    answers = ['第二个回答'];
    service.send({ entryId: 1, question: '第二问？' });
    await vi.waitFor(() => {
      expect(requests).toHaveLength(2);
      expect(service.getState({ entryId: 1 }).messages).toHaveLength(4);
    });

    expect(requests[1]?.messages).toEqual([
      { role: 'user', content: '第一问？' },
      { role: 'assistant', content: '第一段，回答。' },
      { role: 'user', content: '第二问？' },
    ]);
  });

  it('isolates history when cleaned article content changes', async () => {
    const { service, contentStore } = createService();
    service.send({ entryId: 1, question: '旧内容问题' });
    await vi.waitFor(() => {
      expect(service.getState({ entryId: 1 }).messages).toHaveLength(2);
    });

    contentStore.upsert({
      entryId: 1,
      sourceUrl: 'https://example.com/post-1',
      markdown: '# 已更新文章\n\n这是新的正文。',
      pipelineStatus: 'success',
    });

    expect(service.getState({ entryId: 1 })).toEqual({
      entryId: 1,
      messages: [],
    });
  });

  it('cancels the active run and persists an interrupted assistant message', async () => {
    let release: (() => void) | undefined;
    const pendingProvider: TextGenerationProvider = {
      async *stream(request) {
        requests.push(request);
        await new Promise<void>((resolve) => {
          release = resolve;
          request.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return;
        yield '';
      },
      testConnection: () => Promise.resolve(),
    };
    const { service } = createService(pendingProvider);
    const started = service.send({ entryId: 1, question: '请等待' });
    service.cancel({ runId: started.runId });
    release?.();

    await vi.waitFor(() => {
      expect(service.getState({ entryId: 1 }).messages[1]).toMatchObject({
        role: 'assistant',
        status: 'interrupted',
      });
    });
    expect(service.getState({ entryId: 1 }).activeRun).toBeUndefined();
  });
});
