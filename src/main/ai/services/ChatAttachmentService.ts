import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  ChatAttachment,
  ChatAttachmentImportFailure,
  ChatAttachmentPickResponse,
  ChatAttachmentRemoveResponse,
  ChatState,
} from '../../../shared/contracts/chat.types';
import {
  CHAT_ERROR_CODES,
  ChatError,
  toChatIpcError,
} from '../../../shared/errors/chat.errors';
import { ChatStore } from '../stores/ChatStore';
import {
  CHAT_PDF_ATTACHMENT_MAX_BYTES,
  detectChatAttachmentType,
  extractChatTextAttachment,
} from './ChatAttachmentTextExtractor';
import { extractChatPdfAttachment } from './ChatPdfTextExtractor';

export const CHAT_ATTACHMENT_LIMIT = 5;
export const CHAT_DRAFT_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1_000;
export const CHAT_ATTACHMENT_CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;

export interface ChatAttachmentStateLookup {
  getState(request: { entryId: number }): ChatState;
}

export interface ChatAttachmentFileSystem {
  stat(filePath: string): Promise<{ isFile: boolean; size: number }>;
  readFile(filePath: string): Promise<Uint8Array>;
}

const defaultFileSystem: ChatAttachmentFileSystem = {
  stat: async (filePath) => {
    const stats = await fs.stat(filePath);
    return { isFile: stats.isFile(), size: stats.size };
  },
  readFile: async (filePath) => Uint8Array.from(await fs.readFile(filePath)),
};

export class ChatAttachmentService {
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly stateLookup: ChatAttachmentStateLookup,
    private readonly chatStore: ChatStore,
    private readonly fileSystem: ChatAttachmentFileSystem = defaultFileSystem,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async importFiles(
    entryId: number,
    filePaths: readonly string[],
  ): Promise<ChatAttachmentPickResponse> {
    const state = this.stateLookup.getState({ entryId });
    if (state.state === 'running') {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_BUSY,
        'Wait for the current answer before adding attachments.',
        true,
      );
    }

    const availableSlots = Math.max(
      0,
      CHAT_ATTACHMENT_LIMIT - state.draftAttachments.length,
    );
    const attachments: ChatAttachment[] = [];
    const failures: ChatAttachmentImportFailure[] = [];

    for (const [index, filePath] of filePaths.entries()) {
      const displayName = safeAttachmentDisplayName(filePath);
      if (index >= availableSlots) {
        failures.push({
          displayName,
          error: toChatIpcError(new ChatError(
            CHAT_ERROR_CODES.CHAT_ATTACHMENT_LIMIT_EXCEEDED,
            `A question can include at most ${CHAT_ATTACHMENT_LIMIT} attachments.`,
            false,
          )),
        });
        continue;
      }

      try {
        attachments.push(await this.importFile(
          state.thread.id,
          displayName,
          filePath,
        ));
      } catch (error) {
        failures.push({
          displayName,
          error: toChatIpcError(error),
        });
      }
    }

    return {
      canceled: false,
      attachments,
      failures,
    };
  }

  removeDraftAttachment(
    entryId: number,
    attachmentId: number,
  ): ChatAttachmentRemoveResponse {
    const state = this.stateLookup.getState({ entryId });
    return {
      removed: this.chatStore.deleteDraftAttachment(
        attachmentId,
        state.thread.id,
      ),
    };
  }

  cleanupExpiredDrafts(): number {
    const expiresAt = this.now().toISOString();
    const expired = this.chatStore.listExpiredDraftAttachments(expiresAt);
    return expired.reduce((count, attachment) => (
      this.chatStore.deleteExpiredDraftAttachment(attachment.id, expiresAt)
        ? count + 1
        : count
    ), 0);
  }

  startCleanupSchedule(): void {
    if (this.cleanupTimer) return;
    this.cleanupExpiredDrafts();
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredDrafts();
    }, CHAT_ATTACHMENT_CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  stopCleanupSchedule(): void {
    if (!this.cleanupTimer) return;
    clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }

  private async importFile(
    threadId: number,
    displayName: string,
    filePath: string,
  ): Promise<ChatAttachment> {
    const stats = await this.fileSystem.stat(filePath);
    if (!stats.isFile) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_ATTACHMENT_TYPE_UNSUPPORTED,
        'Only regular files can be attached.',
        false,
      );
    }
    if (stats.size === 0) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_ATTACHMENT_PARSE_FAILED,
        'The selected attachment is empty.',
        false,
      );
    }
    if (stats.size > CHAT_PDF_ATTACHMENT_MAX_BYTES) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_ATTACHMENT_TOO_LARGE,
        'The selected attachment exceeds the 20 MB file limit.',
        false,
      );
    }

    const bytes = await this.fileSystem.readFile(filePath);
    const type = detectChatAttachmentType(bytes);
    const extracted = type === 'pdf'
      ? await extractChatPdfAttachment(bytes)
      : extractChatTextAttachment(bytes);
    const expiresAt = new Date(
      this.now().getTime() + CHAT_DRAFT_ATTACHMENT_TTL_MS,
    ).toISOString();
    return this.chatStore.createTextAttachment({
      threadId,
      displayName,
      mimeType: extracted.mimeType,
      byteSize: extracted.byteSize,
      textContent: extracted.textContent,
      contentHash: extracted.contentHash,
      expiresAt,
    });
  }
}

export const safeAttachmentDisplayName = (filePath: string): string => {
  const baseName = [...path.basename(filePath)
    .normalize('NFC')
  ].filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint > 31 && codePoint !== 127;
  }).join('')
    .trim();
  return (baseName || 'attachment').slice(0, 180);
};
