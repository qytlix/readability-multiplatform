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
      testConnection: () => Promise.resolve(),
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
      testConnection: () => Promise.resolve(),
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

  it('cancels an active run and ignores late Provider output', async () => {
    const harness = createChatServiceHarness(async function* () {
      await new Promise((resolve) => setTimeout(resolve, 20));
      yield 'late';
    });
    const events: string[] = [];
    harness.service.subscribe((event) => events.push(event.type));
    const response = await harness.service.send({
      entryId: 1,
      question: 'cancel me',
      attachmentIds: [],
    });

    harness.service.cancel({ runId: response.runId });
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(events).toEqual(['started', 'interrupted']);
    expect(harness.chatStore.findRunById(response.runId)?.status).toBe('interrupted');
    expect(harness.chatStore.findMessageById(response.assistantMessageId)).toMatchObject({
      status: 'interrupted',
      content: '',
    });
  });

  it('retries a failed run without duplicating the user message', async () => {
    let attempt = 0;
    const harness = createChatServiceHarness(async function* () {
      attempt += 1;
      if (attempt === 1) throw new Error('provider failed');
      yield 'recovered';
    });
    const failedEvent = new Promise<void>((resolve) => {
      harness.service.subscribe((event) => {
        if (event.type === 'failed') resolve();
      });
    });
    const first = await harness.service.send({
      entryId: 1,
      question: 'retry me',
      attachmentIds: [],
    });
    await failedEvent;
    expect(harness.chatStore.findRunById(first.runId)?.status).toBe('failed');

    const completedEvent = new Promise<void>((resolve) => {
      harness.service.subscribe((event) => {
        if (event.type === 'completed') resolve();
      });
    });
    const retried = await harness.service.retry({ runId: first.runId });
    await completedEvent;

    expect(retried).toMatchObject({ runId: first.runId, reused: true });
    expect(harness.chatStore.listMessages(retried.threadId)).toMatchObject([
      { role: 'user', content: 'retry me' },
      { role: 'assistant', content: 'recovered', status: 'completed' },
    ]);
  });

  it('interrupts the active run when the current article changes', async () => {
    const harness = createChatServiceHarness(async function* () {
      await new Promise((resolve) => setTimeout(resolve, 30));
      yield 'late';
    });
    const response = await harness.service.send({
      entryId: 1,
      question: 'switch article',
      attachmentIds: [],
    });

    harness.service.handleEntryChange(2);

    expect(harness.chatStore.findRunById(response.runId)?.status).toBe('interrupted');
  });
});

function createChatServiceHarness(
  stream: TextGenerationProvider['stream'],
): {
  service: ChatService;
  chatStore: ChatStore;
} {
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
  const provider: TextGenerationProvider = {
    stream,
    testConnection: () => Promise.resolve(),
  };
  const chatStore = new ChatStore(db);
  return {
    chatStore,
    service: new ChatService(
      contentStore,
      profileStore,
      { read: () => 'secret' },
      chatStore,
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
    ),
  };
}
