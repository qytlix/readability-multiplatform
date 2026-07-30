import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatStore } from '../../src/main/ai/stores/ChatStore';
import { ProviderProfileStore } from '../../src/main/ai/stores/ProviderProfileStore';
import { UsageStore } from '../../src/main/ai/stores/UsageStore';
import { DatabaseManager } from '../../src/main/database/DatabaseManager';

describe('Article Chat restart recovery', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('interrupts one durable run and all of its usage rows without losing input', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'shale-chat-recovery-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'shale.sqlite');
    const initial = new DatabaseManager(databasePath);
    initial.runMigrations();
    const initialDb = initial.getDb();
    insertEntry(initialDb);

    const providerProfileId = new ProviderProfileStore(initialDb).saveActive({
      providerKind: 'openai',
      baseUrl: 'https://provider.example/v1',
      model: 'chat-recovery-model',
      apiKeyRef: 'opaque-secret-reference',
    }).id;
    const initialChatStore = new ChatStore(initialDb);
    const thread = initialChatStore.findOrCreateThread(
      1,
      'article-content-hash',
      'article-chat-v1',
    );
    const attachment = initialChatStore.createTextAttachment({
      threadId: thread.id,
      displayName: 'private-notes.txt',
      mimeType: 'text/plain',
      byteSize: 18,
      textContent: 'private source text',
      contentHash: 'attachment-content-hash',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    const created = initialChatStore.createRunWithMessages({
      threadId: thread.id,
      question: 'Explain the selected claim.',
      selection: {
        entryId: 1,
        text: 'selected claim',
        paragraphContext: 'The selected claim is in its original paragraph.',
        segmentId: 'segment-1',
      },
      providerProfileId,
      providerKind: 'openai',
      model: 'chat-recovery-model',
      promptVersion: 'article-chat-v1',
      contextMode: 'article-map',
      articleContentHash: 'article-content-hash',
      inputContentHash: 'pending-context-hash',
    });
    initialChatStore.linkAttachments(created.userMessage.id, [attachment.id]);
    initialChatStore.appendAssistantDelta(created.run.id, 'Partial answer');

    const initialUsageStore = new UsageStore(initialDb);
    for (const [providerRequestId, requestKind] of [
      [30_001, 'chat-segment-analysis'],
      [30_002, 'chat-answer'],
    ] as const) {
      initialUsageStore.createRunning({
        providerRequestId,
        attemptId: 'chat-recovery-attempt',
        taskType: 'chat',
        taskRunId: created.run.id,
        providerProfileId,
        model: 'chat-recovery-model',
        requestKind,
      });
    }
    initial.close();

    const restarted = new DatabaseManager(databasePath);
    restarted.runMigrations();
    try {
      const restartedDb = restarted.getDb();
      const restartedUsageStore = new UsageStore(restartedDb);
      const restartedChatStore = new ChatStore(restartedDb);

      expect(restartedUsageStore.reconcileInterruptedRunning()).toBe(2);
      expect(restartedChatStore.reconcileInterruptedRuns()).toBe(1);
      expect(restartedChatStore.findRunById(created.run.id)).toMatchObject({
        status: 'interrupted',
        contextMode: 'article-map',
        error: {
          code: 'CHAT_INTERRUPTED',
          retryable: true,
        },
      });
      expect(restartedChatStore.listMessages(thread.id)).toMatchObject([
        {
          id: created.userMessage.id,
          role: 'user',
          content: 'Explain the selected claim.',
          selection: {
            text: 'selected claim',
            segmentId: 'segment-1',
          },
          attachments: [{
            id: attachment.id,
            displayName: 'private-notes.txt',
          }],
        },
        {
          id: created.assistantMessage.id,
          role: 'assistant',
          status: 'interrupted',
          content: 'Partial answer',
        },
      ]);
      expect(restartedChatStore.listMessages(thread.id)[0]?.attachments[0])
        .not.toHaveProperty('textContent');
      expect(restartedUsageStore.listByTask('chat', created.run.id))
        .toMatchObject([
          {
            attemptId: 'chat-recovery-attempt',
            requestKind: 'chat-segment-analysis',
            requestStatus: 'interrupted',
            errorCode: 'AI_INTERRUPTED',
          },
          {
            attemptId: 'chat-recovery-attempt',
            requestKind: 'chat-answer',
            requestStatus: 'interrupted',
            errorCode: 'AI_INTERRUPTED',
          },
        ]);
      expect(restartedDb.pragma('foreign_key_check')).toEqual([]);
    } finally {
      restarted.close();
    }
  });
});

function insertEntry(database: ReturnType<DatabaseManager['getDb']>): void {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO feed (title, feedURL, siteURL, lastSyncStatus, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'Recovery Feed',
    'https://example.com/feed.xml',
    'https://example.com',
    'success',
    now,
  );
  database.prepare(`
    INSERT INTO entry
      (feedId, guid, url, title, publishedAt, isRead, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    1,
    'recovery-guid',
    'https://example.com/recovery',
    'Recovery Article',
    now,
    0,
    now,
    now,
  );
}
