import { beforeEach, describe, expect, it } from 'vitest';
import { ChatStore } from '../../src/main/ai/stores/ChatStore';
import { ProviderProfileStore } from '../../src/main/ai/stores/ProviderProfileStore';
import { buildTestDbWithData } from '../fixtures/databases/feed-fixture';

describe('ChatStore threads and messages', () => {
  let store: ChatStore;
  let providerId: number;

  beforeEach(() => {
    const { db } = buildTestDbWithData();
    store = new ChatStore(db);
    providerId = new ProviderProfileStore(db).saveActive({
      providerKind: 'openai',
      baseUrl: 'https://provider.example/v1',
      model: 'example-model',
      apiKeyRef: 'secret-reference',
    }).id;
  });

  it('creates user message, assistant placeholder, and run atomically', () => {
    const thread = store.findOrCreateThread(1, 'content-a', 'article-chat-v1');
    const created = store.createRunWithMessages({
      threadId: thread.id,
      question: 'What is the claim?',
      providerProfileId: providerId,
      providerKind: 'openai',
      model: 'example-model',
      promptVersion: 'article-chat-v1',
      contextMode: 'full',
      articleContentHash: 'content-a',
      inputContentHash: 'input-a',
    });

    expect(created.run.status).toBe('running');
    expect(created.userMessage).toMatchObject({
      role: 'user',
      status: 'completed',
      content: 'What is the claim?',
    });
    expect(created.assistantMessage).toMatchObject({
      role: 'assistant',
      status: 'running',
      content: '',
    });
    expect(store.listMessages(thread.id)).toHaveLength(2);
  });

  it('rolls back both messages when run creation violates a foreign key', () => {
    const thread = store.findOrCreateThread(1, 'content-a', 'article-chat-v1');

    expect(() => store.createRunWithMessages({
      threadId: thread.id,
      question: 'Will this roll back?',
      providerProfileId: providerId + 10_000,
      providerKind: 'openai',
      model: 'example-model',
      promptVersion: 'article-chat-v1',
      contextMode: 'full',
      articleContentHash: 'content-a',
      inputContentHash: 'input-a',
    })).toThrow();
    expect(store.listMessages(thread.id)).toEqual([]);
  });

  it('reconciles and retries a run without duplicating its user message', () => {
    const thread = store.findOrCreateThread(1, 'content-a', 'article-chat-v1');
    const created = store.createRunWithMessages({
      threadId: thread.id,
      question: 'Keep one copy.',
      providerProfileId: providerId,
      providerKind: 'openai',
      model: 'example-model',
      promptVersion: 'article-chat-v1',
      contextMode: 'full',
      articleContentHash: 'content-a',
      inputContentHash: 'input-a',
    });
    store.appendAssistantDelta(created.run.id, 'Partial');

    expect(store.reconcileInterruptedRuns()).toBe(1);
    expect(store.findRunById(created.run.id)).toMatchObject({
      status: 'interrupted',
      error: { code: 'CHAT_INTERRUPTED', retryable: true },
    });

    const retried = store.retryRun(created.run.id);
    expect(retried.run.id).toBe(created.run.id);
    expect(retried.userMessage.id).toBe(created.userMessage.id);
    expect(retried.assistantMessage).toMatchObject({
      id: created.assistantMessage.id,
      content: '',
      status: 'running',
    });
    expect(store.listMessages(thread.id)).toHaveLength(2);
  });

  it('reuses a thread for the same content hash and isolates changed content', () => {
    const first = store.findOrCreateThread(1, 'content-a', 'article-chat-v1');
    const reused = store.findOrCreateThread(1, 'content-a', 'article-chat-v1');
    const changed = store.findOrCreateThread(1, 'content-b', 'article-chat-v1');

    expect(reused.id).toBe(first.id);
    expect(changed.id).not.toBe(first.id);
    expect(changed.sourceContentHash).toBe('content-b');
  });

  it('persists ordered messages and structured selection context', () => {
    const thread = store.findOrCreateThread(1, 'content-a', 'article-chat-v1');
    store.createMessage({
      threadId: thread.id,
      role: 'user',
      content: 'Explain this.',
      status: 'completed',
      selection: {
        entryId: 1,
        text: 'selected words',
        paragraphContext: 'The selected words appear here.',
        segmentId: 'segment-2',
      },
      articleContextMode: 'full',
      articleContentHash: 'content-a',
    });
    store.createMessage({
      threadId: thread.id,
      role: 'assistant',
      content: 'Explanation.',
      status: 'completed',
      articleContextMode: 'full',
      articleContentHash: 'content-a',
    });

    expect(store.listMessages(thread.id)).toMatchObject([
      {
        role: 'user',
        content: 'Explain this.',
        selection: {
          entryId: 1,
          text: 'selected words',
          paragraphContext: 'The selected words appear here.',
          segmentId: 'segment-2',
        },
      },
      { role: 'assistant', content: 'Explanation.' },
    ]);
  });
});
