import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatAttachmentStorage } from '../../../src/main/ai/services/ChatAttachmentStorage';
import type { NormalizedChatImage } from '../../../src/main/ai/services/ChatImageNormalizer';
import type { StoredChatAttachment } from '../../../src/main/ai/stores/ChatStore';

describe('Article Chat attachment storage', () => {
  let rootDirectory: string;
  let storage: ChatAttachmentStorage;

  beforeEach(() => {
    rootDirectory = mkdtempSync(path.join(tmpdir(), 'shale-chat-storage-'));
    storage = new ChatAttachmentStorage(rootDirectory);
  });

  afterEach(() => {
    rmSync(rootDirectory, { recursive: true, force: true });
  });

  it('writes and reuses content-addressed normalized bytes', () => {
    const image = createImage('a'.repeat(64), Uint8Array.from([1, 2, 3]));
    const firstKey = storage.writeImage(image);
    const secondKey = storage.writeImage(image);

    expect(firstKey).toBe(`${'a'.repeat(64)}.png`);
    expect(secondKey).toBe(firstKey);
    expect(readdirSync(rootDirectory)).toEqual([firstKey]);
    expect(storage.readImage(createAttachment(firstKey))).toEqual(
      Uint8Array.from([1, 2, 3]),
    );
  });

  it('rejects a conflicting file at the same content address', () => {
    const image = createImage('b'.repeat(64), Uint8Array.from([1, 2, 3]));
    const storageKey = `${image.contentHash}.png`;
    writeFileSync(path.join(rootDirectory, storageKey), Uint8Array.from([9]));

    expect(() => storage.writeImage(image)).toThrowError(
      expect.objectContaining({ code: 'CHAT_IMAGE_INVALID' }),
    );
  });

  it.each([
    '../outside.png',
    `${'c'.repeat(63)}.png`,
    `${'c'.repeat(64)}.exe`,
    `folder/${'c'.repeat(64)}.png`,
  ])('rejects an unsafe storage key: %s', (storageKey) => {
    expect(() => storage.readImage(createAttachment(storageKey))).toThrowError(
      expect.objectContaining({ code: 'CHAT_ATTACHMENT_NOT_FOUND' }),
    );
  });

  it('removes only a validated image file', () => {
    const storageKey = storage.writeImage(
      createImage('d'.repeat(64), Uint8Array.from([4, 5, 6])),
    );

    expect(storage.removeImage(storageKey)).toBe(true);
    expect(storage.removeImage(storageKey)).toBe(false);
    expect(existsSync(path.join(rootDirectory, storageKey))).toBe(false);
  });
});

function createImage(
  contentHash: string,
  bytes: Uint8Array,
): NormalizedChatImage {
  return {
    bytes,
    mimeType: 'image/png',
    byteSize: bytes.length,
    width: 20,
    height: 10,
    contentHash,
    normalizationVersion: 'chat-image-v1',
  };
}

function createAttachment(storageKey: string): StoredChatAttachment {
  return {
    id: 1,
    threadId: 2,
    kind: 'image',
    displayName: 'image.png',
    mimeType: 'image/png',
    byteSize: 3,
    contentHash: 'a'.repeat(64),
    storageKey,
    width: 20,
    height: 10,
    createdAt: '2026-07-30T00:00:00.000Z',
  };
}
