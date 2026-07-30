import { describe, expect, it } from 'vitest';
import { ProviderProfileStore } from '../../src/main/ai/stores/ProviderProfileStore';
import { ChatStore } from '../../src/main/ai/stores/ChatStore';
import { ChatService } from '../../src/main/ai/services/ChatService';
import type { TextGenerationProvider } from '../../src/main/ai/provider/TextGenerationProvider';
import { buildTestDbWithData } from '../fixtures/databases/feed-fixture';
import { ContentStore } from '../../src/main/feed/stores/ContentStore';

describe('ChatService', () => {
  it('streams and persists a content-scoped answer with full event identity', async () => {
    const { db } = buildTestDbWithData();
    const contentStore = new ContentStore(db);
    contentStore.upsert({
      entryId: 1,
      markdown: 'Article body',
      cleanedHtml: '<p>Article body</p>',
      sourceContentHash: 'article-hash',
      pipelineStatus: 'success',
    });
    const profileStore = new ProviderProfileStore(db);
    profileStore.saveActive({
      summary: {
        providerKind: 'openai',
        baseUrl: 'https://provider.test/v1',
        model: 'summary-model',
        apiKeyRef: 'summary-key',
      },
      translation: {
        providerKind: 'openai',
        baseUrl: 'https://provider.test/v1',
        model: 'translation-model',
        apiKeyRef: 'translation-key',
      },
      tag: {
        providerKind: 'openai',
        baseUrl: 'https://provider.test/v1',
        model: 'tag-model',
        apiKeyRef: 'tag-key',
      },
      chat: {
        providerKind: 'openai',
        baseUrl: 'https://provider.test/v1',
        model: 'chat-model',
        apiKeyRef: 'chat-key',
        supportsImages: false,
      },
    });
    const provider: TextGenerationProvider = {
      async *stream(request) {
        expect(request.systemInstruction).toContain('Shale Article Guide');
        expect(request.messages).toHaveLength(2);
        yield 'First ';
        yield 'answer.';
      },
      async testConnection() {},
    };
    const chatStore = new ChatStore(db);
    const service = new ChatService(
      contentStore,
      profileStore,
      { read: () => 'secret' },
      chatStore,
      {
        prepare: async () => ({
          mode: 'full',
          systemInstruction: 'You are Shale Article Guide.',
          articleReference: '<article-context>Article body</article-context>',
          historyReference: '',
          estimatedPromptTokens: 20,
          cacheHit: false,
          relatedSegmentIds: [],
        }),
      },
      provider,
    );
    const events: string[] = [];
    const completed = new Promise<void>((resolve) => {
      service.subscribe((event) => {
        events.push(event.type);
        expect(event).toMatchObject({
          runId: expect.any(Number),
          threadId: expect.any(Number),
          entryId: 1,
          messageId: expect.any(Number),
        });
        if (event.type === 'completed') resolve();
      });
    });

    const response = await service.send({
      entryId: 1,
      question: 'What is the point?',
      attachmentIds: [],
    });
    await completed;

    expect(events).toEqual(['started', 'delta', 'delta', 'completed']);
    expect(chatStore.findRunById(response.runId)?.status).toBe('succeeded');
    expect(chatStore.findMessageById(response.assistantMessageId)).toMatchObject({
      status: 'completed',
      content: 'First answer.',
    });
    expect(service.getState({ entryId: 1 })).toMatchObject({
      state: 'idle',
      messages: [
        { role: 'user', content: 'What is the point?' },
        { role: 'assistant', content: 'First answer.' },
      ],
    });
  });

  it('rejects a second run before creating duplicate messages', async () => {
    const { db } = buildTestDbWithData();
    const contentStore = new ContentStore(db);
    contentStore.upsert({
      entryId: 1,
      markdown: 'Article body',
      sourceContentHash: 'article-hash',
      pipelineStatus: 'success',
    });
    const profileStore = new ProviderProfileStore(db);
    profileStore.saveActive({
      providerKind: 'openai',
      baseUrl: 'https://provider.test/v1',
      model: 'chat-model',
      apiKeyRef: 'chat-key',
    });
    let release: (() => void) | undefined;
    const provider: TextGenerationProvider = {
      async *stream() {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        yield 'done';
      },
      async testConnection() {},
    };
    const service = new ChatService(
      contentStore,
      profileStore,
      { read: () => 'secret' },
      new ChatStore(db),
      {
        prepare: async () => ({
          mode: 'full',
          systemInstruction: 'system',
          articleReference: 'article',
          historyReference: '',
          estimatedPromptTokens: 2,
          cacheHit: false,
          relatedSegmentIds: [],
        }),
      },
      provider,
    );

    await service.send({ entryId: 1, question: 'first', attachmentIds: [] });
    await expect(service.send({
      entryId: 1,
      question: 'second',
      attachmentIds: [],
    })).rejects.toMatchObject({ code: 'CHAT_BUSY' });
    release?.();
  });
});
