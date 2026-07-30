import type Database from 'better-sqlite3';
import type {
  ChatAttachment,
  ChatContextMode,
  ChatMessage,
  ChatMessageRole,
  ChatMessageStatus,
  ChatSelectionContext,
  ChatThread,
  ChatRun,
} from '../../../shared/contracts/chat.types';
import type { ShaleError } from '../../../shared/contracts/feed.ipc';
import type { ProviderKind } from '../../../shared/contracts/provider.types';
import { CHAT_ERROR_CODES } from '../../../shared/errors/chat.errors';

interface ChatThreadRow {
  id: number;
  entryId: number;
  sourceContentHash: string;
  contextPromptVersion: string;
  active: number;
  createdAt: string;
  updatedAt: string;
}

interface ChatMessageRow {
  id: number;
  threadId: number;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  selectedText: string | null;
  selectedContext: string | null;
  articleContextMode: ChatContextMode;
  articleContentHash: string;
  createdAt: string;
  updatedAt: string;
}

interface ChatRunRow {
  id: number;
  threadId: number;
  userMessageId: number;
  assistantMessageId: number;
  providerProfileId: number;
  providerKind: ProviderKind;
  model: string;
  status: ChatRun['status'];
  promptVersion: string;
  contextMode: ChatContextMode;
  inputContentHash: string;
  errorCode: string | null;
  errorMessage: string | null;
  errorRetryable: number | null;
  createdAt: string;
  completedAt: string | null;
}

interface ChatAttachmentRow {
  id: number;
  threadId: number;
  kind: ChatAttachment['kind'];
  displayName: string;
  mimeType: string;
  byteSize: number;
  textContent: string | null;
  contentHash: string;
  storageKey: string | null;
  width: number | null;
  height: number | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreateChatMessageParams {
  threadId: number;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  selection?: ChatSelectionContext;
  articleContextMode: ChatContextMode;
  articleContentHash: string;
}

export interface CreateChatRunParams {
  threadId: number;
  question: string;
  selection?: ChatSelectionContext;
  providerProfileId: number;
  providerKind: ProviderKind;
  model: string;
  promptVersion: string;
  contextMode: ChatContextMode;
  articleContentHash: string;
  inputContentHash: string;
}

export interface CreatedChatRun {
  run: ChatRun;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}

export interface CreateTextChatAttachmentParams {
  threadId: number;
  displayName: string;
  mimeType: string;
  byteSize: number;
  textContent: string;
  contentHash: string;
  expiresAt: string;
}

export interface CreateImageChatAttachmentParams {
  threadId: number;
  displayName: string;
  mimeType: 'image/png' | 'image/jpeg';
  byteSize: number;
  contentHash: string;
  storageKey: string;
  width: number;
  height: number;
  expiresAt: string;
}

export interface StoredChatAttachment extends ChatAttachment {
  textContent?: string;
  storageKey?: string;
}

export class ChatStore {
  constructor(private readonly db: Database.Database) {}

  findOrCreateThread(
    entryId: number,
    sourceContentHash: string,
    contextPromptVersion: string,
  ): ChatThread {
    const existing = this.findActiveThread(entryId, sourceContentHash);
    if (existing) return existing;

    const now = new Date().toISOString();
    try {
      const result = this.db.prepare(`
        INSERT INTO ai_chat_thread
          (entryId, sourceContentHash, contextPromptVersion, active, createdAt, updatedAt)
        VALUES (?, ?, ?, 1, ?, ?)
      `).run(entryId, sourceContentHash, contextPromptVersion, now, now);
      return {
        id: Number(result.lastInsertRowid),
        entryId,
        sourceContentHash,
        contextPromptVersion,
        active: true,
        createdAt: now,
        updatedAt: now,
      };
    } catch (error) {
      // A concurrent caller may have won the partial unique-index race.
      const raced = this.findActiveThread(entryId, sourceContentHash);
      if (raced) return raced;
      throw error;
    }
  }

  findActiveThread(
    entryId: number,
    sourceContentHash: string,
  ): ChatThread | undefined {
    const row = this.db.prepare(`
      SELECT * FROM ai_chat_thread
      WHERE entryId = ? AND sourceContentHash = ? AND active = 1
      ORDER BY id DESC LIMIT 1
    `).get(entryId, sourceContentHash) as ChatThreadRow | undefined;
    return row ? toChatThread(row) : undefined;
  }

  findThreadById(threadId: number): ChatThread | undefined {
    const row = this.db.prepare('SELECT * FROM ai_chat_thread WHERE id = ?')
      .get(threadId) as ChatThreadRow | undefined;
    return row ? toChatThread(row) : undefined;
  }

  createMessage(params: CreateChatMessageParams): ChatMessage {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO ai_chat_message
        (threadId, role, content, status, selectedText, selectedContext,
         articleContextMode, articleContentHash, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.threadId,
      params.role,
      params.content,
      params.status,
      params.selection?.text ?? null,
      params.selection ? JSON.stringify(params.selection) : null,
      params.articleContextMode,
      params.articleContentHash,
      now,
      now,
    );
    this.touchThread(params.threadId, now);
    return {
      id: Number(result.lastInsertRowid),
      threadId: params.threadId,
      role: params.role,
      content: params.content,
      status: params.status,
      ...(params.selection ? { selection: params.selection } : {}),
      articleContextMode: params.articleContextMode,
      articleContentHash: params.articleContentHash,
      attachments: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  listMessages(threadId: number): ChatMessage[] {
    const rows = this.db.prepare(`
      SELECT * FROM ai_chat_message
      WHERE threadId = ?
      ORDER BY createdAt ASC, id ASC
    `).all(threadId) as ChatMessageRow[];
    return rows.map((row) => toChatMessage(
      row,
      this.listAttachmentsForMessage(row.id),
    ));
  }

  findMessageById(messageId: number): ChatMessage | undefined {
    const row = this.db.prepare('SELECT * FROM ai_chat_message WHERE id = ?')
      .get(messageId) as ChatMessageRow | undefined;
    return row
      ? toChatMessage(row, this.listAttachmentsForMessage(row.id))
      : undefined;
  }

  createTextAttachment(
    params: CreateTextChatAttachmentParams,
  ): ChatAttachment {
    return this.insertAttachment({
      ...params,
      kind: 'text',
      storageKey: null,
      width: null,
      height: null,
    });
  }

  createImageAttachment(
    params: CreateImageChatAttachmentParams,
  ): ChatAttachment {
    return this.insertAttachment({
      ...params,
      kind: 'image',
      textContent: null,
    });
  }

  findStoredAttachment(attachmentId: number): StoredChatAttachment | undefined {
    const row = this.db.prepare('SELECT * FROM ai_chat_attachment WHERE id = ?')
      .get(attachmentId) as ChatAttachmentRow | undefined;
    return row ? toStoredChatAttachment(row) : undefined;
  }

  listDraftAttachments(threadId: number): ChatAttachment[] {
    const rows = this.db.prepare(`
      SELECT attachment.* FROM ai_chat_attachment AS attachment
      LEFT JOIN ai_chat_message_attachment AS linked
        ON linked.attachmentId = attachment.id
      WHERE attachment.threadId = ? AND linked.attachmentId IS NULL
      ORDER BY attachment.createdAt ASC, attachment.id ASC
    `).all(threadId) as ChatAttachmentRow[];
    return rows.map(toPublicChatAttachment);
  }

  linkAttachments(messageId: number, attachmentIds: readonly number[]): void {
    if (attachmentIds.length > 5) {
      throw new Error('A Chat message can contain at most five attachments.');
    }
    if (new Set(attachmentIds).size !== attachmentIds.length) {
      throw new Error('A Chat message cannot contain duplicate attachment IDs.');
    }
    const message = this.db.prepare(
      'SELECT threadId FROM ai_chat_message WHERE id = ?',
    ).get(messageId) as { threadId: number } | undefined;
    if (!message) throw new Error('Chat message was not found.');

    const persist = this.db.transaction(() => {
      for (const [orderIndex, attachmentId] of attachmentIds.entries()) {
        const attachment = this.db.prepare(`
          SELECT threadId FROM ai_chat_attachment WHERE id = ?
        `).get(attachmentId) as { threadId: number } | undefined;
        if (!attachment || attachment.threadId !== message.threadId) {
          throw new Error('Chat attachment does not belong to this conversation.');
        }
        this.db.prepare(`
          INSERT INTO ai_chat_message_attachment
            (messageId, attachmentId, orderIndex)
          VALUES (?, ?, ?)
        `).run(messageId, attachmentId, orderIndex);
        this.db.prepare(`
          UPDATE ai_chat_attachment SET expiresAt = NULL WHERE id = ?
        `).run(attachmentId);
      }
    });
    persist();
  }

  deleteDraftAttachment(attachmentId: number, threadId: number): boolean {
    const result = this.db.prepare(`
      DELETE FROM ai_chat_attachment
      WHERE id = ? AND threadId = ?
        AND NOT EXISTS (
          SELECT 1 FROM ai_chat_message_attachment
          WHERE attachmentId = ai_chat_attachment.id
        )
    `).run(attachmentId, threadId);
    return result.changes === 1;
  }

  createRunWithMessages(params: CreateChatRunParams): CreatedChatRun {
    const now = new Date().toISOString();
    const persist = this.db.transaction(() => {
      const userMessageId = this.insertMessage({
        threadId: params.threadId,
        role: 'user',
        content: params.question,
        status: 'completed',
        selection: params.selection,
        articleContextMode: params.contextMode,
        articleContentHash: params.articleContentHash,
      }, now);
      const assistantMessageId = this.insertMessage({
        threadId: params.threadId,
        role: 'assistant',
        content: '',
        status: 'running',
        articleContextMode: params.contextMode,
        articleContentHash: params.articleContentHash,
      }, now);
      const inserted = this.db.prepare(`
        INSERT INTO ai_chat_run
          (threadId, userMessageId, assistantMessageId, providerProfileId,
           providerKind, model, status, promptVersion, contextMode,
           inputContentHash, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)
      `).run(
        params.threadId,
        userMessageId,
        assistantMessageId,
        params.providerProfileId,
        params.providerKind,
        params.model,
        params.promptVersion,
        params.contextMode,
        params.inputContentHash,
        now,
      );
      this.touchThread(params.threadId, now);
      return {
        runId: Number(inserted.lastInsertRowid),
        userMessageId,
        assistantMessageId,
      };
    });
    const created = persist();
    const run = this.findRunById(created.runId);
    const userMessage = this.findMessageById(created.userMessageId);
    const assistantMessage = this.findMessageById(created.assistantMessageId);
    if (!run || !userMessage || !assistantMessage) {
      throw new Error('Chat run transaction did not persist its complete graph.');
    }
    return { run, userMessage, assistantMessage };
  }

  findRunById(runId: number): ChatRun | undefined {
    const row = this.db.prepare('SELECT * FROM ai_chat_run WHERE id = ?')
      .get(runId) as ChatRunRow | undefined;
    return row ? toChatRun(row) : undefined;
  }

  findRunningRun(): ChatRun | undefined {
    const row = this.db.prepare(`
      SELECT * FROM ai_chat_run
      WHERE status = 'running'
      ORDER BY id DESC LIMIT 1
    `).get() as ChatRunRow | undefined;
    return row ? toChatRun(row) : undefined;
  }

  findLatestRunForThread(threadId: number): ChatRun | undefined {
    const row = this.db.prepare(`
      SELECT * FROM ai_chat_run
      WHERE threadId = ?
      ORDER BY id DESC LIMIT 1
    `).get(threadId) as ChatRunRow | undefined;
    return row ? toChatRun(row) : undefined;
  }

  appendAssistantDelta(runId: number, delta: string): ChatMessage {
    const run = this.findRunById(runId);
    if (!run || run.status !== 'running') {
      throw new Error('Cannot append output to an inactive Chat run.');
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE ai_chat_message
      SET content = content || ?, updatedAt = ?
      WHERE id = ? AND status = 'running'
    `).run(delta, now, run.assistantMessageId);
    const message = this.findMessageById(run.assistantMessageId);
    if (!message) throw new Error('Chat assistant message disappeared.');
    return message;
  }

  markRunSucceeded(runId: number): ChatRun {
    const now = new Date().toISOString();
    const persist = this.db.transaction(() => {
      const row = this.db.prepare(
        'SELECT assistantMessageId FROM ai_chat_run WHERE id = ? AND status = ?',
      ).get(runId, 'running') as { assistantMessageId: number } | undefined;
      if (!row) throw new Error('Chat run is not active.');
      this.db.prepare(`
        UPDATE ai_chat_message
        SET status = 'completed', updatedAt = ?
        WHERE id = ? AND status = 'running'
      `).run(now, row.assistantMessageId);
      this.db.prepare(`
        UPDATE ai_chat_run
        SET status = 'succeeded', errorCode = NULL, errorMessage = NULL,
            errorRetryable = NULL, completedAt = ?
        WHERE id = ? AND status = 'running'
      `).run(now, runId);
    });
    persist();
    const run = this.findRunById(runId);
    if (!run) throw new Error('Chat run disappeared after completion.');
    return run;
  }

  markRunFailed(
    runId: number,
    error: ShaleError,
    status: 'failed' | 'interrupted' = 'failed',
  ): ChatRun {
    const now = new Date().toISOString();
    const persist = this.db.transaction(() => {
      const row = this.db.prepare(
        'SELECT assistantMessageId FROM ai_chat_run WHERE id = ? AND status = ?',
      ).get(runId, 'running') as { assistantMessageId: number } | undefined;
      if (!row) throw new Error('Chat run is not active.');
      this.db.prepare(`
        UPDATE ai_chat_message SET status = ?, updatedAt = ?
        WHERE id = ? AND status = 'running'
      `).run(status, now, row.assistantMessageId);
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
        runId,
      );
    });
    persist();
    const run = this.findRunById(runId);
    if (!run) throw new Error('Chat run disappeared after failure.');
    return run;
  }

  retryRun(runId: number): CreatedChatRun {
    const existing = this.findRunById(runId);
    if (!existing || existing.status === 'running' || existing.status === 'succeeded') {
      throw new Error('Only failed or interrupted Chat runs can be retried.');
    }
    const now = new Date().toISOString();
    const persist = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE ai_chat_message
        SET content = '', status = 'running', updatedAt = ?
        WHERE id = ?
      `).run(now, existing.assistantMessageId);
      this.db.prepare(`
        UPDATE ai_chat_run
        SET status = 'running', errorCode = NULL, errorMessage = NULL,
            errorRetryable = NULL, completedAt = NULL
        WHERE id = ?
      `).run(runId);
    });
    persist();
    const run = this.findRunById(runId);
    const userMessage = this.findMessageById(existing.userMessageId);
    const assistantMessage = this.findMessageById(existing.assistantMessageId);
    if (!run || !userMessage || !assistantMessage) {
      throw new Error('Chat retry did not preserve its message graph.');
    }
    return { run, userMessage, assistantMessage };
  }

  reconcileInterruptedRuns(): number {
    const rows = this.db.prepare(`
      SELECT id FROM ai_chat_run WHERE status = 'running'
    `).all() as Array<{ id: number }>;
    for (const row of rows) {
      this.markRunFailed(row.id, {
        code: CHAT_ERROR_CODES.CHAT_INTERRUPTED,
        message: 'Article Chat generation was interrupted before completion.',
        retryable: true,
      }, 'interrupted');
    }
    return rows.length;
  }

  private insertMessage(
    params: CreateChatMessageParams,
    now: string,
  ): number {
    const result = this.db.prepare(`
      INSERT INTO ai_chat_message
        (threadId, role, content, status, selectedText, selectedContext,
         articleContextMode, articleContentHash, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.threadId,
      params.role,
      params.content,
      params.status,
      params.selection?.text ?? null,
      params.selection ? JSON.stringify(params.selection) : null,
      params.articleContextMode,
      params.articleContentHash,
      now,
      now,
    );
    return Number(result.lastInsertRowid);
  }

  private insertAttachment(
    params: (
      CreateTextChatAttachmentParams
      & {
        kind: 'text';
        storageKey: null;
        width: null;
        height: null;
      }
    ) | (
      CreateImageChatAttachmentParams
      & { kind: 'image'; textContent: null }
    ),
  ): ChatAttachment {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO ai_chat_attachment
        (threadId, kind, displayName, mimeType, byteSize, textContent,
         contentHash, storageKey, width, height, expiresAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.threadId,
      params.kind,
      params.displayName,
      params.mimeType,
      params.byteSize,
      params.textContent,
      params.contentHash,
      params.storageKey,
      params.width,
      params.height,
      params.expiresAt,
      now,
    );
    const stored = this.findStoredAttachment(Number(result.lastInsertRowid));
    if (!stored) throw new Error('Chat attachment was not persisted.');
    return omitStoredContent(stored);
  }

  private listAttachmentsForMessage(messageId: number): ChatAttachment[] {
    const rows = this.db.prepare(`
      SELECT attachment.*
      FROM ai_chat_message_attachment AS linked
      JOIN ai_chat_attachment AS attachment ON attachment.id = linked.attachmentId
      WHERE linked.messageId = ?
      ORDER BY linked.orderIndex ASC
    `).all(messageId) as ChatAttachmentRow[];
    return rows.map(toPublicChatAttachment);
  }

  private touchThread(threadId: number, updatedAt: string): void {
    this.db.prepare('UPDATE ai_chat_thread SET updatedAt = ? WHERE id = ?')
      .run(updatedAt, threadId);
  }
}

function toChatThread(row: ChatThreadRow): ChatThread {
  return {
    id: row.id,
    entryId: row.entryId,
    sourceContentHash: row.sourceContentHash,
    contextPromptVersion: row.contextPromptVersion,
    active: row.active === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toChatMessage(
  row: ChatMessageRow,
  attachments: ChatAttachment[],
): ChatMessage {
  const selection = parseSelection(row.selectedContext, row.selectedText);
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    content: row.content,
    status: row.status,
    ...(selection ? { selection } : {}),
    articleContextMode: row.articleContextMode,
    articleContentHash: row.articleContentHash,
    attachments,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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
    userMessageId: row.userMessageId,
    assistantMessageId: row.assistantMessageId,
    providerProfileId: row.providerProfileId,
    providerKind: row.providerKind,
    model: row.model,
    status: row.status,
    promptVersion: row.promptVersion,
    contextMode: row.contextMode,
    inputContentHash: row.inputContentHash,
    ...(error ? { error } : {}),
    createdAt: row.createdAt,
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
  };
}

function toPublicChatAttachment(row: ChatAttachmentRow): ChatAttachment {
  return {
    id: row.id,
    threadId: row.threadId,
    kind: row.kind,
    displayName: row.displayName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    contentHash: row.contentHash,
    ...(row.width === null ? {} : { width: row.width }),
    ...(row.height === null ? {} : { height: row.height }),
    ...(row.expiresAt === null ? {} : { expiresAt: row.expiresAt }),
    createdAt: row.createdAt,
  };
}

function toStoredChatAttachment(row: ChatAttachmentRow): StoredChatAttachment {
  return {
    ...toPublicChatAttachment(row),
    ...(row.textContent === null ? {} : { textContent: row.textContent }),
    ...(row.storageKey === null ? {} : { storageKey: row.storageKey }),
  };
}

function omitStoredContent(attachment: StoredChatAttachment): ChatAttachment {
  return {
    id: attachment.id,
    threadId: attachment.threadId,
    kind: attachment.kind,
    displayName: attachment.displayName,
    mimeType: attachment.mimeType,
    byteSize: attachment.byteSize,
    contentHash: attachment.contentHash,
    ...(attachment.width === undefined ? {} : { width: attachment.width }),
    ...(attachment.height === undefined ? {} : { height: attachment.height }),
    ...(attachment.expiresAt === undefined ? {} : {
      expiresAt: attachment.expiresAt,
    }),
    createdAt: attachment.createdAt,
  };
}

function parseSelection(
  serialized: string | null,
  selectedText: string | null,
): ChatSelectionContext | undefined {
  if (!serialized || !selectedText) return undefined;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const selection = parsed as Record<string, unknown>;
    if (
      typeof selection.entryId !== 'number'
      || selection.text !== selectedText
      || typeof selection.paragraphContext !== 'string'
      || (
        selection.segmentId !== undefined
        && typeof selection.segmentId !== 'string'
      )
    ) {
      return undefined;
    }
    return {
      entryId: selection.entryId,
      text: selectedText,
      paragraphContext: selection.paragraphContext,
      ...(typeof selection.segmentId === 'string'
        ? { segmentId: selection.segmentId }
        : {}),
    };
  } catch {
    return undefined;
  }
}
