import { describe, expect, it, vi } from 'vitest';
import {
  CHAT_DRAFT_ATTACHMENT_TTL_MS,
  ChatAttachmentService,
  safeAttachmentDisplayName,
  type ChatAttachmentFileSystem,
} from '../../src/main/ai/services/ChatAttachmentService';
import { ChatStore } from '../../src/main/ai/stores/ChatStore';
import { buildTestDbWithData } from '../fixtures/databases/feed-fixture';

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
  });
});

function createHarness(
  files: Map<string, Uint8Array>,
  now: () => Date = () => new Date('2026-07-30T00:00:00.000Z'),
): {
  service: ChatAttachmentService;
  store: ChatStore;
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
  return {
    service: new ChatAttachmentService(stateLookup, store, fileSystem, now),
    store,
  };
}
