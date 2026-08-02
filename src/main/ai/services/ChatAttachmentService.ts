import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  ChatAttachment,
  ChatAttachmentImportFailure,
  ChatAttachmentPickResponse,
  ChatAttachmentPreviewResponse,
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
import {
  normalizeChatImage,
  type NormalizedChatImage,
} from './ChatImageNormalizer';
import { ChatAttachmentStorage } from './ChatAttachmentStorage';
import {
  CHAT_LOG_ERROR_CODES,
  createChatFailureTerminal,
  elapsedChatMilliseconds,
  logChatAttachmentOperationFailed,
  type ChatAttachmentFailureStage,
  type ChatAttachmentLogOperation,
  type ChatFailureTerminal,
  type ChatOperationLogger,
} from './ChatLogging';
import { performance } from 'node:perf_hooks';

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

export type ChatImageNormalizationPort = (
  sourceBytes: Uint8Array,
) => NormalizedChatImage;

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
    private readonly imageStorage?: ChatAttachmentStorage,
    private readonly imageNormalizer: ChatImageNormalizationPort = normalizeChatImage,
    private readonly logger?: ChatOperationLogger,
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
    const startedAt = performance.now();
    const terminal = createChatFailureTerminal();

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
        const reportedError = this.recordSystemFailure(
          terminal,
          'import',
          startedAt,
          error,
        );
        failures.push({
          displayName,
          error: toChatIpcError(reportedError),
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
    const startedAt = performance.now();
    const terminal = createChatFailureTerminal();
    try {
      let attachment: ReturnType<ChatStore['findStoredAttachment']>;
      try {
        attachment = this.chatStore.findStoredAttachment(attachmentId);
      } catch (error) {
        throw new ChatAttachmentSystemFailure('database-read', error);
      }
      let removed: boolean;
      try {
        removed = this.chatStore.deleteDraftAttachment(
          attachmentId,
          state.thread.id,
        );
      } catch (error) {
        throw new ChatAttachmentSystemFailure('database-write', error);
      }
      if (removed && attachment) this.removeOrphanedImageFile(attachment);
      return { removed };
    } catch (error) {
      throw this.recordSystemFailure(terminal, 'remove', startedAt, error);
    }
  }

  importClipboardImage(
    entryId: number,
    bytes: Uint8Array,
    suggestedDisplayName: string,
    declaredMimeType: string,
  ): ChatAttachment {
    // These values are untrusted hints only. Naming and type come from the
    // normalized bytes so clipboard metadata cannot alter persistence.
    void suggestedDisplayName;
    void declaredMimeType;
    const state = this.stateLookup.getState({ entryId });
    if (state.state === 'running') {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_BUSY,
        'Wait for the current answer before adding an image.',
        true,
      );
    }
    if (state.draftAttachments.length >= CHAT_ATTACHMENT_LIMIT) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_ATTACHMENT_LIMIT_EXCEEDED,
        `A question can include at most ${CHAT_ATTACHMENT_LIMIT} attachments.`,
        false,
      );
    }
    const startedAt = performance.now();
    const terminal = createChatFailureTerminal();
    try {
      const normalized = this.imageNormalizer(bytes);
      const extension = normalized.mimeType === 'image/png' ? 'png' : 'jpg';
      return this.persistImage(
        state.thread.id,
        `pasted-image-${normalized.contentHash.slice(0, 12)}.${extension}`,
        normalized,
      );
    } catch (error) {
      throw this.recordSystemFailure(terminal, 'import', startedAt, error);
    }
  }

  previewImage(
    entryId: number,
    attachmentId: number,
  ): ChatAttachmentPreviewResponse {
    const state = this.stateLookup.getState({ entryId });
    const startedAt = performance.now();
    const terminal = createChatFailureTerminal();
    try {
      let attachment: ReturnType<ChatStore['findStoredAttachment']>;
      try {
        attachment = this.chatStore.findStoredAttachment(attachmentId);
      } catch (error) {
        throw new ChatAttachmentSystemFailure('database-read', error);
      }
      if (
        !attachment
        || attachment.threadId !== state.thread.id
        || attachment.kind !== 'image'
        || attachment.width === undefined
        || attachment.height === undefined
        || !this.imageStorage
      ) {
        throw new ChatError(
          CHAT_ERROR_CODES.CHAT_ATTACHMENT_NOT_FOUND,
          'The image attachment preview is unavailable.',
          false,
        );
      }
      let imageBytes: Uint8Array;
      try {
        imageBytes = this.imageStorage.readImage(attachment);
      } catch (error) {
        throw new ChatAttachmentSystemFailure('file-read', error);
      }
      return {
        mimeType: attachment.mimeType === 'image/png'
          ? 'image/png'
          : 'image/jpeg',
        bytes: imageBytes,
        width: attachment.width,
        height: attachment.height,
      };
    } catch (error) {
      throw this.recordSystemFailure(terminal, 'preview', startedAt, error);
    }
  }

  cleanupExpiredDrafts(): number {
    const startedAt = performance.now();
    const terminal = createChatFailureTerminal();
    try {
      const expiresAt = this.now().toISOString();
      let expired: ReturnType<ChatStore['listExpiredDraftAttachments']>;
      try {
        expired = this.chatStore.listExpiredDraftAttachments(expiresAt);
      } catch (error) {
        throw new ChatAttachmentSystemFailure('database-read', error);
      }
      return expired.reduce((count, attachment) => {
        let removed: boolean;
        try {
          removed = this.chatStore.deleteExpiredDraftAttachment(
            attachment.id,
            expiresAt,
          );
        } catch (error) {
          throw new ChatAttachmentSystemFailure('database-write', error);
        }
        if (!removed) return count;
        this.removeOrphanedImageFile(attachment);
        return count + 1;
      }, 0);
    } catch (error) {
      throw this.recordSystemFailure(terminal, 'cleanup', startedAt, error);
    }
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
    let stats: Awaited<ReturnType<ChatAttachmentFileSystem['stat']>>;
    try {
      stats = await this.fileSystem.stat(filePath);
    } catch (error) {
      throw new ChatAttachmentSystemFailure('file-read', error);
    }
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

    let bytes: Uint8Array;
    try {
      bytes = await this.fileSystem.readFile(filePath);
    } catch (error) {
      throw new ChatAttachmentSystemFailure('file-read', error);
    }
    const type = detectChatAttachmentType(bytes);
    if (type === 'png' || type === 'jpeg' || type === 'webp') {
      return this.persistImage(
        threadId,
        displayName,
        this.imageNormalizer(bytes),
      );
    }
    const extracted = type === 'pdf'
      ? await extractChatPdfAttachment(bytes)
      : extractChatTextAttachment(bytes);
    const expiresAt = new Date(
      this.now().getTime() + CHAT_DRAFT_ATTACHMENT_TTL_MS,
    ).toISOString();
    try {
      return this.chatStore.createTextAttachment({
        threadId,
        displayName,
        mimeType: extracted.mimeType,
        byteSize: extracted.byteSize,
        textContent: extracted.textContent,
        contentHash: extracted.contentHash,
        expiresAt,
      });
    } catch (error) {
      throw new ChatAttachmentSystemFailure('database-write', error);
    }
  }

  private persistImage(
    threadId: number,
    displayName: string,
    image: NormalizedChatImage,
  ): ChatAttachment {
    if (!this.imageStorage) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_IMAGE_UNSUPPORTED,
        'Image attachment storage is unavailable.',
        false,
      );
    }
    let storageKey: string;
    try {
      storageKey = this.imageStorage.writeImage(image);
    } catch (error) {
      throw new ChatAttachmentSystemFailure('file-write', error);
    }
    const expiresAt = new Date(
      this.now().getTime() + CHAT_DRAFT_ATTACHMENT_TTL_MS,
    ).toISOString();
    try {
      return this.chatStore.createImageAttachment({
        threadId,
        displayName,
        mimeType: image.mimeType,
        byteSize: image.byteSize,
        contentHash: image.contentHash,
        storageKey,
        width: image.width,
        height: image.height,
        expiresAt,
      });
    } catch (error) {
      try {
        if (this.chatStore.countImageStorageReferences(storageKey) === 0) {
          this.imageStorage.removeImage(storageKey);
        }
      } catch {
        // Preserve the database failure as the operation's single terminal.
      }
      throw new ChatAttachmentSystemFailure('database-write', error);
    }
  }

  private removeOrphanedImageFile(
    attachment: { kind: 'text' | 'image'; storageKey?: string },
  ): void {
    if (attachment.kind !== 'image' || !attachment.storageKey || !this.imageStorage) {
      return;
    }
    let referenceCount: number;
    try {
      referenceCount = this.chatStore.countImageStorageReferences(
        attachment.storageKey,
      );
    } catch (error) {
      throw new ChatAttachmentSystemFailure('database-read', error);
    }
    if (referenceCount > 0) return;
    try {
      this.imageStorage.removeImage(attachment.storageKey);
    } catch (error) {
      throw new ChatAttachmentSystemFailure('cleanup', error);
    }
  }

  private recordSystemFailure(
    terminal: ChatFailureTerminal,
    operation: ChatAttachmentLogOperation,
    startedAt: number,
    error: unknown,
  ): unknown {
    if (!(error instanceof ChatAttachmentSystemFailure)) return error;
    logChatAttachmentOperationFailed(this.logger, terminal, {
      operation,
      finalFailureStage: error.stage,
      durationMs: elapsedChatMilliseconds(startedAt),
      success: false,
      errorCode: CHAT_LOG_ERROR_CODES.attachmentOperationFailed,
    });
    return error.originalError;
  }
}

class ChatAttachmentSystemFailure extends Error {
  constructor(
    readonly stage: ChatAttachmentFailureStage,
    readonly originalError: unknown,
  ) {
    super('Article Chat attachment system operation failed.');
    this.name = 'ChatAttachmentSystemFailure';
  }
}

export const safeAttachmentDisplayName = (filePath: string): string => {
  const baseName = [...path.win32.basename(filePath)
    .normalize('NFC')
  ].filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint > 31 && codePoint !== 127;
  }).join('')
    .trim();
  return (baseName || 'attachment').slice(0, 180);
};
