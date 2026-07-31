import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  CHAT_ERROR_CODES,
  ChatError,
} from '../../../shared/errors/chat.errors';
import type { StoredChatAttachment } from '../stores/ChatStore';
import type { NormalizedChatImage } from './ChatImageNormalizer';
import type { ChatAttachmentContentLoader } from './ChatService';

const STORAGE_KEY_PATTERN = /^[a-f0-9]{64}\.(?:jpg|png)$/u;

export class ChatAttachmentStorage implements ChatAttachmentContentLoader {
  readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = path.resolve(rootDirectory);
  }

  writeImage(image: NormalizedChatImage): string {
    const extension = image.mimeType === 'image/png' ? 'png' : 'jpg';
    const storageKey = `${image.contentHash}.${extension}`;
    const targetPath = this.resolveStorageKey(storageKey);
    mkdirSync(this.rootDirectory, { recursive: true, mode: 0o700 });
    try {
      writeFileSync(targetPath, image.bytes, {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      const existing = readFileSync(targetPath);
      if (!existing.equals(Buffer.from(image.bytes))) {
        throw new ChatError(
          CHAT_ERROR_CODES.CHAT_IMAGE_INVALID,
          'A stored image failed its content-addressed integrity check.',
          false,
        );
      }
    }
    return storageKey;
  }

  readImage(attachment: StoredChatAttachment): Uint8Array {
    if (attachment.kind !== 'image' || !attachment.storageKey) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_ATTACHMENT_NOT_FOUND,
        'The image attachment is unavailable.',
        false,
      );
    }
    try {
      return Uint8Array.from(
        readFileSync(this.resolveStorageKey(attachment.storageKey)),
      );
    } catch (error) {
      if (error instanceof ChatError) throw error;
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_ATTACHMENT_NOT_FOUND,
        'The image attachment is unavailable.',
        false,
      );
    }
  }

  removeImage(storageKey: string): boolean {
    try {
      rmSync(this.resolveStorageKey(storageKey));
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      if (error instanceof ChatError) throw error;
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_ATTACHMENT_NOT_FOUND,
        'The stored image could not be removed.',
        false,
      );
    }
  }

  private resolveStorageKey(storageKey: string): string {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_ATTACHMENT_NOT_FOUND,
        'The image attachment storage identity is invalid.',
        false,
      );
    }
    const resolved = path.resolve(this.rootDirectory, storageKey);
    if (
      resolved === this.rootDirectory
      || !resolved.startsWith(`${this.rootDirectory}${path.sep}`)
    ) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_ATTACHMENT_NOT_FOUND,
        'The image attachment storage identity is invalid.',
        false,
      );
    }
    return resolved;
  }
}

const isAlreadyExistsError = (error: unknown): boolean => (
  hasErrorCode(error)
  && error.code === 'EEXIST'
);

const isNotFoundError = (error: unknown): boolean => (
  hasErrorCode(error)
  && error.code === 'ENOENT'
);

const hasErrorCode = (error: unknown): error is { code: unknown } => (
  error !== null
  && typeof error === 'object'
  && 'code' in error
);
