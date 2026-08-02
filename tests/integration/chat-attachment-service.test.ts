import { describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CHAT_DRAFT_ATTACHMENT_TTL_MS,
  ChatAttachmentService,
  safeAttachmentDisplayName,
  type ChatAttachmentStateLookup,
  type ChatAttachmentFileSystem,
} from '../../src/main/ai/services/ChatAttachmentService';
import { ChatStore } from '../../src/main/ai/stores/ChatStore';
import { ChatAttachmentStorage } from '../../src/main/ai/services/ChatAttachmentStorage';
import type { NormalizedChatImage } from '../../src/main/ai/services/ChatImageNormalizer';
import { buildTestDbWithData } from '../fixtures/databases/feed-fixture';
import {
  CHAT_LOG_ERROR_CODES,
  CHAT_LOG_EVENTS,
} from '../../src/main/ai/services/ChatLogging';

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('ChatAttachmentService', () => {
  it('imports supported files independently and reports a safe partial failure', async () => {
    const harness = createHarness(new Map([
      ['C:\\private\\notes.md', encode('# Notes')],
      ['C:\\private\\evidence.html', encode(
        '<html><body><p>Evidence</p></body></html>',
      )],
      ['C:\\private\\renamed.txt', Uint8Array.from([0x00, 0xff])],
    ]));

    const result = await harness.service.importFiles(1, [
      'C:\\private\\notes.md',
      'C:\\private\\evidence.html',
      'C:\\private\\renamed.txt',
    ]);

    expect(result.attachments).toMatchObject([
      { displayName: 'notes.md', mimeType: 'text/plain' },
      { displayName: 'evidence.html', mimeType: 'text/html' },
    ]);
    expect(result.failures).toEqual([{
      displayName: 'renamed.txt',
      error: expect.objectContaining({
        code: 'CHAT_ATTACHMENT_TYPE_UNSUPPORTED',
      }),
    }]);
    expect(JSON.stringify(result)).not.toContain('C:\\private');
    expect(harness.logger.error).not.toHaveBeenCalled();
  });

  it('records one safe terminal for legal attachment system failures', async () => {
    const harness = createHarness(new Map());

    const result = await harness.service.importFiles(1, [
      'C:\\private\\first.md',
      'C:\\private\\second.md',
    ]);

    expect(result.failures).toHaveLength(2);
    expect(harness.logger.error).toHaveBeenCalledOnce();
    expect(harness.logger.error).toHaveBeenCalledWith(
      CHAT_LOG_EVENTS.attachmentOperationFailed,
      'chat.attachment',
      {
        operation: 'import',
        finalFailureStage: 'file-read',
        durationMs: expect.any(Number),
        success: false,
        errorCode: CHAT_LOG_ERROR_CODES.attachmentOperationFailed,
      },
    );
    expect(JSON.stringify(harness.logger.error.mock.calls)).not.toContain('private');
    expect(JSON.stringify(harness.logger.error.mock.calls)).not.toContain('CANARY');
  });

  it('distinguishes attachment database and cleanup failures', async () => {
    const databaseHarness = createHarness(new Map([
      ['notes.md', encode('valid notes')],
    ]));
    vi.spyOn(databaseHarness.store, 'createTextAttachment').mockImplementation(() => {
      throw new Error('SQLITE_ATTACHMENT_CANARY');
    });

    await databaseHarness.service.importFiles(1, ['notes.md']);

    expect(databaseHarness.logger.error).toHaveBeenCalledWith(
      CHAT_LOG_EVENTS.attachmentOperationFailed,
      'chat.attachment',
      expect.objectContaining({
        operation: 'import',
        finalFailureStage: 'database-write',
        errorCode: CHAT_LOG_ERROR_CODES.attachmentOperationFailed,
      }),
    );

    const cleanupHarness = createHarness(new Map());
    vi.spyOn(cleanupHarness.store, 'listExpiredDraftAttachments')
      .mockImplementation(() => {
        throw new Error('SQLITE_CLEANUP_CANARY');
      });

    expect(() => cleanupHarness.service.cleanupExpiredDrafts()).toThrow();
    expect(cleanupHarness.logger.error).toHaveBeenCalledWith(
      CHAT_LOG_EVENTS.attachmentOperationFailed,
      'chat.attachment',
      expect.objectContaining({
        operation: 'cleanup',
        finalFailureStage: 'database-read',
        errorCode: CHAT_LOG_ERROR_CODES.attachmentOperationFailed,
      }),
    );
  });

  it('expires only unlinked draft attachments after 24 hours', async () => {
    let currentTime = new Date('2026-07-30T00:00:00.000Z');
    const harness = createHarness(
      new Map([['draft.md', encode('draft')]]),
      () => currentTime,
    );
    const imported = await harness.service.importFiles(1, ['draft.md']);
    expect(imported.attachments[0]?.expiresAt).toBe(
      new Date(
        currentTime.getTime() + CHAT_DRAFT_ATTACHMENT_TTL_MS,
      ).toISOString(),
    );

    currentTime = new Date(
      currentTime.getTime() + CHAT_DRAFT_ATTACHMENT_TTL_MS + 1,
    );
    expect(harness.service.cleanupExpiredDrafts()).toBe(1);
    expect(harness.store.findStoredAttachment(
      imported.attachments[0]?.id ?? 0,
    )).toBeUndefined();
  });

  it('removes a draft only from the active article conversation', async () => {
    const harness = createHarness(
      new Map([['draft.md', encode('draft')]]),
    );
    const imported = await harness.service.importFiles(1, ['draft.md']);
    const attachmentId = imported.attachments[0]?.id ?? 0;

    expect(harness.service.removeDraftAttachment(1, attachmentId)).toEqual({
      removed: true,
    });
    expect(harness.service.removeDraftAttachment(1, attachmentId)).toEqual({
      removed: false,
    });
  });

  it('sanitizes display names without returning a source directory', () => {
    expect(safeAttachmentDisplayName(
      'C:\\secret\\line\u0000break.md',
    )).toBe('linebreak.md');
    expect(safeAttachmentDisplayName(
      '/secret/line\u0000break.md',
    )).toBe('linebreak.md');
    expect(safeAttachmentDisplayName(
      'C:\\secret/mixed\\line\u0000break.md',
    )).toBe('linebreak.md');
  });

  it('reuses normalized image bytes and removes the file after the last draft', async () => {
    const rootDirectory = mkdtempSync(path.join(tmpdir(), 'shale-chat-images-'));
    try {
      const imageBytes = Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const harness = createHarness(new Map([
        ['first.png', imageBytes],
        ['second.png', imageBytes],
      ]));
      const storage = new ChatAttachmentStorage(rootDirectory);
      const normalized = createNormalizedImage();
      const service = new ChatAttachmentService(
        harness.stateLookup,
        harness.store,
        harness.fileSystem,
        () => new Date('2026-07-30T00:00:00.000Z'),
        storage,
        () => normalized,
      );
      const imported = await service.importFiles(1, [
        'first.png',
        'second.png',
      ]);
      const storageKey = `${normalized.contentHash}.png`;

      expect(imported.attachments).toHaveLength(2);
      expect(harness.store.countImageStorageReferences(storageKey)).toBe(2);
      expect(existsSync(path.join(rootDirectory, storageKey))).toBe(true);
      expect(service.removeDraftAttachment(
        1,
        imported.attachments[0]?.id ?? 0,
      )).toEqual({ removed: true });
      expect(existsSync(path.join(rootDirectory, storageKey))).toBe(true);
      expect(service.removeDraftAttachment(
        1,
        imported.attachments[1]?.id ?? 0,
      )).toEqual({ removed: true });
      expect(existsSync(path.join(rootDirectory, storageKey))).toBe(false);
    } finally {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it('gives repeated pasted bytes a deterministic normalized name', () => {
    const rootDirectory = mkdtempSync(path.join(tmpdir(), 'shale-chat-paste-'));
    try {
      const harness = createHarness(new Map());
      const normalized = createNormalizedImage();
      const service = new ChatAttachmentService(
        harness.stateLookup,
        harness.store,
        harness.fileSystem,
        () => new Date('2026-07-30T00:00:00.000Z'),
        new ChatAttachmentStorage(rootDirectory),
        () => normalized,
      );
      const first = service.importClipboardImage(
        1,
        Uint8Array.from([1]),
        'Screenshot 2026.png',
        'text/plain',
      );
      const second = service.importClipboardImage(
        1,
        Uint8Array.from([1]),
        'Different source.webp',
        'image/webp',
      );

      expect(first.displayName).toBe(
        `pasted-image-${normalized.contentHash.slice(0, 12)}.png`,
      );
      expect(second.displayName).toBe(first.displayName);
    } finally {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  });
});

function createHarness(
  files: Map<string, Uint8Array>,
  now: () => Date = () => new Date('2026-07-30T00:00:00.000Z'),
): {
  service: ChatAttachmentService;
  store: ChatStore;
  stateLookup: ChatAttachmentStateLookup;
  fileSystem: ChatAttachmentFileSystem;
  logger: ReturnType<typeof createLoggerDouble>;
} {
  const { db } = buildTestDbWithData();
  const store = new ChatStore(db);
  const thread = store.findOrCreateThread(1, 'article-hash', 'article-chat-v1');
  const fileSystem: ChatAttachmentFileSystem = {
    stat: vi.fn(async (filePath) => {
      const content = files.get(filePath);
      if (!content) throw new Error('missing test file');
      return { isFile: true, size: content.length };
    }),
    readFile: vi.fn(async (filePath) => {
      const content = files.get(filePath);
      if (!content) throw new Error('missing test file');
      return content;
    }),
  };
  const stateLookup = {
    getState: () => ({
      state: 'idle' as const,
      thread,
      messages: [],
      draftAttachments: store.listDraftAttachments(thread.id),
    }),
  };
  const logger = createLoggerDouble();
  return {
    service: new ChatAttachmentService(
      stateLookup,
      store,
      fileSystem,
      now,
      undefined,
      undefined,
      logger,
    ),
    store,
    stateLookup,
    fileSystem,
    logger,
  };
}

function createLoggerDouble() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createNormalizedImage(): NormalizedChatImage {
  return {
    bytes: Uint8Array.from([1, 2, 3, 4]),
    mimeType: 'image/png',
    byteSize: 4,
    width: 32,
    height: 24,
    contentHash: 'f'.repeat(64),
    normalizationVersion: 'chat-image-v1',
  };
}
