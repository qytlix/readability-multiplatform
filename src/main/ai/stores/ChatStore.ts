import type Database from 'better-sqlite3';
import type {
  ChatAttachment,
  ChatContextMode,
  ChatMessage,
  ChatMessageRole,
  ChatMessageStatus,
  ChatSelectionContext,
  ChatThread,
} from '../../../shared/contracts/chat.types';

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

export interface CreateChatMessageParams {
  threadId: number;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  selection?: ChatSelectionContext;
  articleContextMode: ChatContextMode;
  articleContentHash: string;
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
    return rows.map((row) => toChatMessage(row, []));
  }

  findMessageById(messageId: number): ChatMessage | undefined {
    const row = this.db.prepare('SELECT * FROM ai_chat_message WHERE id = ?')
      .get(messageId) as ChatMessageRow | undefined;
    return row ? toChatMessage(row, []) : undefined;
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

