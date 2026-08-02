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

  it('finalizes a reserved run with its actual context identity', () => {
    const thread = store.findOrCreateThread(1, 'content-a', 'article-chat-v1');
    const created = store.createRunWithMessages({
      threadId: thread.id,
      question: 'What is the claim?',
      providerProfileId: providerId,
      providerKind: 'openai',
      model: 'example-model',
      promptVersion: 'article-chat-v1',
      contextMode: 'article-map',
      articleContentHash: 'content-a',
      inputContentHash: 'pending-input',
    });

    expect(store.finalizeRunContext(
      created.run.id,
      'history-compressed',
      'final-input',
    )).toMatchObject({
      id: created.run.id,
      contextMode: 'history-compressed',
      inputContentHash: 'final-input',
    });
    expect(store.listMessages(thread.id)).toMatchObject([
      { articleContextMode: 'history-compressed' },
      { articleContextMode: 'history-compressed' },
    ]);
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

  it('replaces the selected user turn and supersedes the visible suffix', () => {
    const thread = store.findOrCreateThread(1, 'content-a', 'article-chat-v1');
    const attachment = store.createTextAttachment({
      threadId: thread.id,
      displayName: 'evidence.txt',
      mimeType: 'text/plain',
      byteSize: 8,
      textContent: 'evidence',
      contentHash: 'evidence-hash',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    const first = store.createRunWithMessages({
      threadId: thread.id,
      question: 'Original question',
      providerProfileId: providerId,
      providerKind: 'openai',
      model: 'example-model',
      promptVersion: 'article-chat-v1',
      contextMode: 'full',
      articleContentHash: 'content-a',
      inputContentHash: 'input-a',
    });
    store.linkAttachments(first.userMessage.id, [attachment.id]);
    store.appendAssistantDelta(first.run.id, 'Original answer');
    store.markRunSucceeded(first.run.id);
    const followUp = store.createRunWithMessages({
      threadId: thread.id,
      question: 'Follow-up question',
      providerProfileId: providerId,
      providerKind: 'openai',
      model: 'example-model',
      promptVersion: 'article-chat-v1',
      contextMode: 'full',
      articleContentHash: 'content-a',
      inputContentHash: 'input-b',
    });
    store.appendAssistantDelta(followUp.run.id, 'Follow-up answer');
    store.markRunSucceeded(followUp.run.id);

    const replacement = store.createReplacementRun({
      userMessageId: first.userMessage.id,
      threadId: thread.id,
      question: 'Edited question',
      attachmentIds: [attachment.id],
      providerProfileId: providerId,
      providerKind: 'openai',
      model: 'example-model',
      promptVersion: 'article-chat-v1',
      contextMode: 'article-map',
      articleContentHash: 'content-a',
      inputContentHash: 'replacement-input',
    });

    expect(store.listMessages(thread.id)).toMatchObject([
      {
        id: replacement.userMessage.id,
        role: 'user',
        content: 'Edited question',
        attachments: [{ id: attachment.id }],
      },
      {
        id: replacement.assistantMessage.id,
        role: 'assistant',
        status: 'running',
      },
    ]);
    expect(store.findCurrentMessageById(first.userMessage.id)).toBeUndefined();
    expect(store.findMessageById(first.userMessage.id)).toMatchObject({
      content: 'Original question',
    });
    expect(store.findLatestRunForThread(thread.id)?.id).toBe(replacement.run.id);
    expect(store.listDraftAttachments(thread.id)).toEqual([]);
  });

  it('links ordered attachment metadata without exposing stored content', () => {
    const thread = store.findOrCreateThread(1, 'content-a', 'article-chat-v1');
    const first = store.createTextAttachment({
      threadId: thread.id,
      displayName: 'notes.md',
      mimeType: 'text/markdown',
      byteSize: 12,
      textContent: '# private',
      contentHash: 'text-hash',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    const second = store.createImageAttachment({
      threadId: thread.id,
      displayName: 'chart.png',
      mimeType: 'image/png',
      byteSize: 3,
      contentHash: 'image-hash',
      storageKey: 'image-hash.png',
      width: 10,
      height: 20,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    const created = store.createRunWithMessages({
      threadId: thread.id,
      question: 'Compare these.',
      providerProfileId: providerId,
      providerKind: 'openai',
      model: 'example-model',
      promptVersion: 'article-chat-v1',
      contextMode: 'full',
      articleContentHash: 'content-a',
      inputContentHash: 'input-a',
    });

    store.linkAttachments(created.userMessage.id, [second.id, first.id]);

    const message = store.findMessageById(created.userMessage.id);
    expect(message?.attachments.map(({ id }) => id)).toEqual([second.id, first.id]);
    expect(message?.attachments[0]).not.toHaveProperty('storageKey');
    expect(message?.attachments[1]).not.toHaveProperty('textContent');
    expect(store.findStoredAttachment(first.id)).toMatchObject({
      textContent: '# private',
    });
    expect(store.listDraftAttachments(thread.id)).toEqual([]);
  });

  it('rejects cross-thread attachment references and protects linked rows', () => {
    const firstThread = store.findOrCreateThread(1, 'content-a', 'article-chat-v1');
    const secondThread = store.findOrCreateThread(1, 'content-b', 'article-chat-v1');
    const attachment = store.createTextAttachment({
      threadId: secondThread.id,
      displayName: 'other.txt',
      mimeType: 'text/plain',
      byteSize: 5,
      textContent: 'other',
      contentHash: 'other-hash',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    const created = store.createRunWithMessages({
      threadId: firstThread.id,
      question: 'Unsafe reference?',
      providerProfileId: providerId,
      providerKind: 'openai',
      model: 'example-model',
      promptVersion: 'article-chat-v1',
      contextMode: 'full',
      articleContentHash: 'content-a',
      inputContentHash: 'input-a',
    });

    expect(() => store.linkAttachments(
      created.userMessage.id,
      [attachment.id],
    )).toThrow('does not belong');
    expect(store.deleteDraftAttachment(attachment.id, firstThread.id)).toBe(false);

    store.linkAttachments(
      store.createMessage({
        threadId: secondThread.id,
        role: 'user',
        content: 'Use it.',
        status: 'completed',
        articleContextMode: 'full',
        articleContentHash: 'content-b',
      }).id,
      [attachment.id],
    );
    expect(store.deleteDraftAttachment(attachment.id, secondThread.id)).toBe(false);
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
