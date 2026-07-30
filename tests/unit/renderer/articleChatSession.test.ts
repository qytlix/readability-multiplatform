import { describe, expect, it } from 'vitest';
import type {
  ChatMessage,
  ChatState,
} from '../../../src/shared/contracts/chat.types';
import { applyChatStreamEvent } from '../../../src/renderer/features/chat/articleChatSession';

const assistantMessage: ChatMessage = {
  id: 12,
  threadId: 3,
  role: 'assistant',
  content: '',
  status: 'running',
  articleContextMode: 'full',
  articleContentHash: 'hash',
  attachments: [],
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
};

const runningState: Extract<ChatState, { state: 'running' }> = {
  state: 'running',
  thread: {
    id: 3,
    entryId: 7,
    sourceContentHash: 'hash',
    contextPromptVersion: 'article-chat-v1',
    active: true,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  },
  messages: [assistantMessage],
  draftAttachments: [],
  run: {
    id: 9,
    threadId: 3,
    userMessageId: 11,
    assistantMessageId: 12,
    providerProfileId: 2,
    providerKind: 'openai',
    model: 'chat-model',
    status: 'running',
    promptVersion: 'article-chat-v1',
    contextMode: 'full',
    inputContentHash: 'input-hash',
    createdAt: '2026-07-30T00:00:00.000Z',
  },
};

describe('Article Chat renderer event isolation', () => {
  it('appends a matching delta to the persisted assistant placeholder', () => {
    const next = applyChatStreamEvent(runningState, 7, {
      type: 'delta',
      runId: 9,
      threadId: 3,
      entryId: 7,
      messageId: 12,
      text: 'Answer',
    });

    expect(next.messages[0]).toMatchObject({
      id: 12,
      content: 'Answer',
      status: 'running',
    });
  });

  it.each([
    ['entry', { entryId: 8 }],
    ['run', { runId: 10 }],
    ['thread', { threadId: 4 }],
    ['message', { messageId: 13 }],
  ])('ignores a delta with a mismatched %s identity', (_label, mismatch) => {
    const next = applyChatStreamEvent(runningState, 7, {
      type: 'delta',
      runId: 9,
      threadId: 3,
      entryId: 7,
      messageId: 12,
      text: 'late',
      ...mismatch,
    });

    expect(next).toBe(runningState);
  });

  it('moves a matching completed event back to idle with the final message', () => {
    const completedMessage = {
      ...assistantMessage,
      content: 'Final answer',
      status: 'completed' as const,
    };
    const next = applyChatStreamEvent(runningState, 7, {
      type: 'completed',
      runId: 9,
      threadId: 3,
      entryId: 7,
      messageId: 12,
      message: completedMessage,
    });

    expect(next).toMatchObject({
      state: 'idle',
      messages: [{ content: 'Final answer', status: 'completed' }],
    });
  });
});
