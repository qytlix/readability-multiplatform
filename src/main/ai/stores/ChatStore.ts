import type Database from 'better-sqlite3';
import type { ShaleError } from '../../../shared/contracts/feed.ipc';
import type {
  ChatMessage,
  ChatMessageRole,
  ChatMessageStatus,
  ChatRun,
  ChatRunStatus,
} from '../../../shared/contracts/chat.types';
import { CHAT_ERROR_CODES } from '../../../shared/errors/chat.errors';

interface ChatThreadRow {
  id: number;
  entryId: number;
  sourceContentHash: string;
  promptVersion: string;
  createdAt: string;
  updatedAt: string;
}

interface ChatMessageRow {
  id: number;
  threadId: number;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  createdAt: string;
  updatedAt: string;
}

interface ChatRunRow {
  id: number;
  threadId: number;
  entryId: number;
  userMessageId: number;
  assistantMessageId: number;
  status: ChatRunStatus;
  errorCode: string | null;
  errorMessage: string | null;
  errorRetryable: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ChatThread {
  id: number;
  entryId: number;
  sourceContentHash: string;
  promptVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedChatTurn {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  run: ChatRun;
}

export class ChatStore {
  constructor(private readonly db: Database.Database) {}

  findThread(
    entryId: number,
    sourceContentHash: string,
    promptVersion: string,
  ): ChatThread | undefined {
    const row = this.db.prepare(`
      SELECT * FROM ai_chat_thread
      WHERE entryId = ? AND sourceContentHash = ? AND promptVersion = ?
    `).get(entryId, sourceContentHash, promptVersion) as ChatThreadRow | undefined;
    return row ? { ...row } : undefined;
  }

  getOrCreateThread(
    entryId: number,
    sourceContentHash: string,
    promptVersion: string,
  ): ChatThread {
    const existing = this.findThread(entryId, sourceContentHash, promptVersion);
    if (existing) return existing;
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO ai_chat_thread
        (entryId, sourceContentHash, promptVersion, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?)
    `).run(entryId, sourceContentHash, promptVersion, now, now);
    return {
      id: Number(result.lastInsertRowid),
      entryId,
      sourceContentHash,
      promptVersion,
      createdAt: now,
      updatedAt: now,
    };
  }

  listMessages(threadId: number): ChatMessage[] {
    const rows = this.db.prepare(`
      SELECT * FROM ai_chat_message WHERE threadId = ? ORDER BY id
    `).all(threadId) as ChatMessageRow[];
    return rows.map(toChatMessage);
  }

  findRunningRun(threadId: number): ChatRun | undefined {
    const row = this.db.prepare(`
      SELECT r.*, t.entryId
      FROM ai_chat_run r
      JOIN ai_chat_thread t ON t.id = r.threadId
      WHERE r.threadId = ? AND r.status = 'running'
      ORDER BY r.id DESC LIMIT 1
    `).get(threadId) as ChatRunRow | undefined;
    return row ? toChatRun(row) : undefined;
  }

  createTurn(
    thread: ChatThread,
    providerProfileId: number,
    question: string,
  ): CreatedChatTurn {
    return this.db.transaction(() => {
      const now = new Date().toISOString();
      const userResult = this.db.prepare(`
        INSERT INTO ai_chat_message
          (threadId, role, content, status, createdAt, updatedAt)
        VALUES (?, 'user', ?, 'succeeded', ?, ?)
      `).run(thread.id, question, now, now);
      const userMessageId = Number(userResult.lastInsertRowid);
      const assistantResult = this.db.prepare(`
        INSERT INTO ai_chat_message
          (threadId, role, content, status, createdAt, updatedAt)
        VALUES (?, 'assistant', '', 'streaming', ?, ?)
      `).run(thread.id, now, now);
      const assistantMessageId = Number(assistantResult.lastInsertRowid);
      const runResult = this.db.prepare(`
        INSERT INTO ai_chat_run
          (threadId, userMessageId, assistantMessageId, providerProfileId,
           status, createdAt)
        VALUES (?, ?, ?, ?, 'running', ?)
      `).run(
        thread.id,
        userMessageId,
        assistantMessageId,
        providerProfileId,
        now,
      );
      const runId = Number(runResult.lastInsertRowid);
      this.db.prepare(`
        UPDATE ai_chat_thread SET updatedAt = ? WHERE id = ?
      `).run(now, thread.id);
      const turn: CreatedChatTurn = {
        userMessage: {
          id: userMessageId,
          threadId: thread.id,
          role: 'user',
          content: question,
          status: 'succeeded',
          createdAt: now,
          updatedAt: now,
        },
        assistantMessage: {
          id: assistantMessageId,
          threadId: thread.id,
          role: 'assistant',
          content: '',
          status: 'streaming',
          createdAt: now,
          updatedAt: now,
        },
        run: {
          id: runId,
          threadId: thread.id,
          entryId: thread.entryId,
          userMessageId,
          assistantMessageId,
          status: 'running',
          createdAt: now,
        },
      };
      return turn;
    })();
  }

  markSucceeded(run: ChatRun, content: string): ChatMessage {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE ai_chat_message
        SET content = ?, status = 'succeeded', updatedAt = ?
        WHERE id = ?
      `).run(content, now, run.assistantMessageId);
      this.db.prepare(`
        UPDATE ai_chat_run
        SET status = 'succeeded', completedAt = ?, errorCode = NULL,
            errorMessage = NULL, errorRetryable = NULL
        WHERE id = ? AND status = 'running'
      `).run(now, run.id);
      this.db.prepare(`
        UPDATE ai_chat_thread SET updatedAt = ? WHERE id = ?
      `).run(now, run.threadId);
    })();
    return {
      id: run.assistantMessageId,
      threadId: run.threadId,
      role: 'assistant',
      content,
      status: 'succeeded',
      createdAt: run.createdAt,
      updatedAt: now,
    };
  }

  markFailed(
    run: ChatRun,
    error: ShaleError,
    interrupted: boolean,
  ): void {
    const now = new Date().toISOString();
    const status: ChatRunStatus = interrupted ? 'interrupted' : 'failed';
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE ai_chat_message SET status = ?, updatedAt = ? WHERE id = ?
      `).run(status, now, run.assistantMessageId);
      this.db.prepare(`
        UPDATE ai_chat_run
        SET status = ?, errorCode = ?, errorMessage = ?, errorRetryable = ?,
            completedAt = ?
        WHERE id = ? AND status = 'running'
      `).run(
        status,
        error.code,
        error.message,
        error.retryable ? 1 : 0,
        now,
        run.id,
      );
    })();
  }

  clearThread(threadId: number): void {
    this.db.prepare('DELETE FROM ai_chat_thread WHERE id = ?').run(threadId);
  }

  reconcileInterruptedRuns(): number {
    return this.db.transaction(() => {
      const now = new Date().toISOString();
      const running = this.db.prepare(`
        SELECT assistantMessageId FROM ai_chat_run WHERE status = 'running'
      `).all() as Array<{ assistantMessageId: number }>;
      for (const row of running) {
        this.db.prepare(`
          UPDATE ai_chat_message
          SET status = 'interrupted', updatedAt = ?
          WHERE id = ?
        `).run(now, row.assistantMessageId);
      }
      const result = this.db.prepare(`
        UPDATE ai_chat_run
        SET status = 'interrupted', errorCode = ?, errorMessage = ?,
            errorRetryable = 1, completedAt = ?
        WHERE status = 'running'
      `).run(
        CHAT_ERROR_CODES.interrupted,
        'AI 问答在应用关闭前未完成。',
        now,
      );
      return result.changes;
    })();
  }
}

function toChatMessage(row: ChatMessageRow): ChatMessage {
  return { ...row };
}

function toChatRun(row: ChatRunRow): ChatRun {
  const error = row.errorCode && row.errorMessage
    ? {
        code: row.errorCode,
        message: row.errorMessage,
        retryable: row.errorRetryable === 1,
      }
    : undefined;
  return {
    id: row.id,
    threadId: row.threadId,
    entryId: row.entryId,
    userMessageId: row.userMessageId,
    assistantMessageId: row.assistantMessageId,
    status: row.status,
    error,
    createdAt: row.createdAt,
    completedAt: row.completedAt ?? undefined,
  };
}
