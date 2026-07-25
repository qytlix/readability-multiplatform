import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { ANNOTATION_IPC_CHANNELS } from '../../../src/shared/contracts/annotation.ipc';
import {
  ANNOTATION_ERROR_CODES,
  AnnotationError,
} from '../../../src/shared/errors/annotation.errors';

const captured = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, request: unknown) => unknown>(),
  authorized: true,
  webContents: {
    mainFrame: {},
  },
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, request: unknown) => unknown,
    ) => {
      captured.handlers.set(channel, handler);
    },
  },
}));

import { registerAnnotationIpcHandlers } from '../../../src/main/ipc/annotation.handler';
import type { AnnotationServices } from '../../../src/main/services';

const annotation = {
  id: 7,
  entryId: 1,
  startOffset: 0,
  endOffset: 5,
  selectedText: 'Hello',
  prefixText: '',
  suffixText: ' world',
  color: 'yellow' as const,
  noteText: '',
  createdAt: '2026-07-24T00:00:00.000Z',
  updatedAt: '2026-07-24T00:00:00.000Z',
};

function register(overrides: Partial<AnnotationServices['annotationService']> = {}) {
  const annotationService = {
    list: vi.fn(() => [annotation]),
    create: vi.fn(() => annotation),
    updateNote: vi.fn(() => ({ ...annotation, noteText: 'Saved' })),
    delete: vi.fn(() => undefined),
    ...overrides,
  };
  registerAnnotationIpcHandlers(
    () => ({
      isDestroyed: () => false,
      webContents: captured.webContents,
    }) as unknown as BrowserWindow,
    { annotationService } as unknown as AnnotationServices,
  );
  return annotationService;
}

function invoke(channel: string, request: unknown): unknown {
  const handler = captured.handlers.get(channel);
  if (!handler) throw new Error(`Missing handler for ${channel}`);
  return handler(captured.authorized
    ? {
        sender: captured.webContents,
        senderFrame: captured.webContents.mainFrame,
      }
    : {}, request);
}

beforeEach(() => {
  captured.handlers.clear();
  captured.authorized = true;
});

describe('annotation IPC handler', () => {
  it('registers typed list, create, update, and delete channels', () => {
    register();

    expect([...captured.handlers.keys()]).toEqual([
      ANNOTATION_IPC_CHANNELS.list,
      ANNOTATION_IPC_CHANNELS.create,
      ANNOTATION_IPC_CHANNELS.updateNote,
      ANNOTATION_IPC_CHANNELS.delete,
    ]);
    expect(invoke(ANNOTATION_IPC_CHANNELS.list, { entryId: 1 })).toEqual({
      ok: true,
      data: [annotation],
    });
  });

  it('validates create requests before calling the service', () => {
    const service = register();

    expect(invoke(ANNOTATION_IPC_CHANNELS.create, {
      entryId: 1,
      startOffset: 0,
      endOffset: 5,
      selectedText: 'Hello',
      prefixText: '',
      suffixText: '',
      color: 'orange',
    })).toEqual({
      ok: false,
      error: {
        code: ANNOTATION_ERROR_CODES.INVALID_REQUEST,
        message: 'The annotation request is invalid.',
        retryable: false,
      },
    });
    expect(service.create).not.toHaveBeenCalled();
  });

  it('returns stable service errors without leaking internal details', () => {
    register({
      updateNote: () => {
        throw new AnnotationError(
          ANNOTATION_ERROR_CODES.NOT_FOUND,
          'The annotation no longer exists.',
        );
      },
    });

    expect(invoke(ANNOTATION_IPC_CHANNELS.updateNote, {
      annotationId: 99,
      noteText: 'Missing',
    })).toEqual({
      ok: false,
      error: {
        code: ANNOTATION_ERROR_CODES.NOT_FOUND,
        message: 'The annotation no longer exists.',
        retryable: false,
      },
    });
  });

  it('rejects unauthorized callers before touching the service', () => {
    captured.authorized = false;
    const service = register();

    expect(invoke(ANNOTATION_IPC_CHANNELS.delete, {
      annotationId: 7,
    })).toEqual({
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized IPC sender.',
        retryable: false,
      },
    });
    expect(service.delete).not.toHaveBeenCalled();
  });
});
