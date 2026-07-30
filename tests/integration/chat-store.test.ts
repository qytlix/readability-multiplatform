import { beforeEach, describe, expect, it } from 'vitest';
import { ChatStore } from '../../src/main/ai/stores/ChatStore';
import { buildTestDbWithData } from '../fixtures/databases/feed-fixture';

describe('ChatStore threads and messages', () => {
  let store: ChatStore;

  beforeEach(() => {
    store = new ChatStore(buildTestDbWithData().db);
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
