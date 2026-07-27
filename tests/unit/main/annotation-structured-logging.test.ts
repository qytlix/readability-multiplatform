import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnotationService } from '../../../src/main/annotations/AnnotationService';
import {
  ANNOTATION_LOG_EVENTS,
  ANNOTATION_OPERATION_ERROR_CODES,
} from '../../../src/main/annotations/AnnotationLogging';
import { DiagnosticExportService } from '../../../src/main/diagnostics/DiagnosticExportService';
import { registerAnnotationIpcHandlers } from '../../../src/main/ipc/annotation.handler';
import { StructuredLogger } from '../../../src/main/logging/StructuredLogger';
import type { AnnotationStore } from '../../../src/main/annotations/AnnotationStore';
import type { EntryStore } from '../../../src/main/feed/stores/EntryStore';
import { ANNOTATION_IPC_CHANNELS } from '../../../src/shared/contracts/annotation.ipc';

const captured = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, request: unknown) => unknown>(),
  webContents: { mainFrame: {} },
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, request: unknown) => unknown,
    ) => captured.handlers.set(channel, handler),
  },
}));

const temporaryDirectories: string[] = [];
const ENTRY_ID = 41;
const ANNOTATION_ID = 7;
const URL_CANARY = 'https://annotation-url-canary.example.test/private';
const ANNOTATION_CANARY = 'ANNOTATION_TEXT_CANARY_MUST_NOT_BE_LOGGED';
const ANCHOR_CANARY = 'ANNOTATION_ANCHOR_CANARY_MUST_NOT_BE_LOGGED';
const ERROR_CANARY = 'ANNOTATION_ERROR_CANARY_MUST_NOT_BE_LOGGED';
const PATH_CANARY = '/private/annotation-path-canary';

const annotation = {
  id: ANNOTATION_ID,
  entryId: ENTRY_ID,
  startOffset: 3,
  endOffset: 8,
  selectedText: ANNOTATION_CANARY,
  prefixText: ANCHOR_CANARY,
  suffixText: ANCHOR_CANARY,
  color: 'yellow' as const,
  noteText: ANNOTATION_CANARY,
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
};

function createDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'shale-annotation-log-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createService(overrides: {
  findByEntry?: () => typeof annotation[];
  create?: () => typeof annotation;
  updateNote?: () => typeof annotation | undefined;
  delete?: () => boolean;
  findEntry?: () => object | undefined;
} = {}): AnnotationService {
  const annotationStore = {
    findByEntry: vi.fn(overrides.findByEntry ?? (() => [])),
    create: vi.fn(overrides.create ?? (() => annotation)),
    updateNote: vi.fn(overrides.updateNote ?? (() => annotation)),
    delete: vi.fn(overrides.delete ?? (() => true)),
  };
  const entryStore = {
    findById: vi.fn(overrides.findEntry ?? (() => ({ id: ENTRY_ID, url: URL_CANARY }))),
  };
  return new AnnotationService(
    annotationStore as unknown as AnnotationStore,
    entryStore as unknown as EntryStore,
  );
}

function register(service: AnnotationService, logger: StructuredLogger): void {
  registerAnnotationIpcHandlers(
    () => ({
      isDestroyed: () => false,
      webContents: captured.webContents,
    }) as never,
    { annotationService: service },
    logger,
  );
}

function invoke(channel: string, request: unknown): unknown {
  const handler = captured.handlers.get(channel);
  if (!handler) throw new Error(`Missing handler for ${channel}`);
  return handler({
    sender: captured.webContents,
    senderFrame: captured.webContents.mainFrame,
  }, request);
}

function createRequest() {
  return {
    entryId: ENTRY_ID,
    startOffset: 3,
    endOffset: 3 + ANNOTATION_CANARY.length,
    selectedText: ANNOTATION_CANARY,
    prefixText: ANCHOR_CANARY,
    suffixText: ANCHOR_CANARY,
    color: 'yellow' as const,
  };
}

function createReport(directory: string): Promise<Awaited<ReturnType<DiagnosticExportService['buildReport']>>> {
  return new DiagnosticExportService({
    logDirectory: directory,
    runtime: {
      applicationVersion: '0.3.0-test',
      electronVersion: '43.0.0-test',
      nodeVersion: '24.0.0-test',
      operatingSystem: 'linux',
      operatingSystemRelease: 'test',
      architecture: 'x64',
      isPackaged: false,
      display: { session: 'wayland', waylandDetected: true, ozonePlatform: 'wayland' },
    },
    now: () => new Date('2026-07-27T12:00:01.000Z'),
    createTemporaryName: () => 'annotation-diagnostics',
  }).buildReport();
}

beforeEach(() => {
  captured.handlers.clear();
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Annotation structured failure logging', () => {
  it('does not log normal operations, cancelled editing, or ordinary validation results', async () => {
    const directory = createDirectory();
    const logger = new StructuredLogger({ directory });
    const service = createService();
    register(service, logger);

    expect(invoke(ANNOTATION_IPC_CHANNELS.list, { entryId: ENTRY_ID })).toMatchObject({ ok: true });
    expect(invoke(ANNOTATION_IPC_CHANNELS.create, createRequest())).toMatchObject({ ok: true });
    expect(invoke(ANNOTATION_IPC_CHANNELS.updateNote, {
      annotationId: ANNOTATION_ID,
      noteText: '',
    })).toMatchObject({ ok: true });
    expect(invoke(ANNOTATION_IPC_CHANNELS.delete, { annotationId: ANNOTATION_ID }))
      .toMatchObject({ ok: true });

    expect(invoke(ANNOTATION_IPC_CHANNELS.create, {
      ...createRequest(),
      endOffset: 999,
    })).toMatchObject({
      ok: false,
      error: { code: 'ANNOTATION_INVALID_REQUEST' },
    });
    expect(invoke(ANNOTATION_IPC_CHANNELS.create, {
      ...createRequest(),
      color: 'orange',
    })).toMatchObject({
      ok: false,
      error: { code: 'ANNOTATION_INVALID_REQUEST' },
    });
    register(createService({ findByEntry: () => [annotation] }), logger);
    expect(invoke(ANNOTATION_IPC_CHANNELS.create, createRequest())).toMatchObject({
      ok: false,
      error: { code: 'ANNOTATION_OVERLAP' },
    });

    await logger.flush();
    expect(readdirSync(directory).filter((name) => name.endsWith('.jsonl'))).toEqual([]);
  });

  it('records stale article and annotation identities as lookup failures without annotation IDs', async () => {
    const directory = createDirectory();
    const logger = new StructuredLogger({ directory });
    register(createService({ findEntry: () => undefined }), logger);
    expect(invoke(ANNOTATION_IPC_CHANNELS.list, { entryId: ENTRY_ID })).toMatchObject({
      ok: false,
      error: { code: 'ANNOTATION_ENTRY_NOT_FOUND' },
    });

    register(createService({ updateNote: () => undefined }), logger);
    expect(invoke(ANNOTATION_IPC_CHANNELS.updateNote, {
      annotationId: ANNOTATION_ID,
      noteText: '',
    })).toMatchObject({
      ok: false,
      error: { code: 'ANNOTATION_NOT_FOUND' },
    });
    await logger.flush();

    const file = readdirSync(directory).find((name) => name.endsWith('.jsonl'));
    if (!file) throw new Error('Expected structured logger output file');
    const records = readFileSync(path.join(directory, file), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records.map((record) => record.context)).toEqual([
      expect.objectContaining({
        operation: 'load',
        stage: 'lookup',
        errorCode: 'ANNOTATION_ENTRY_NOT_FOUND',
        entryId: ENTRY_ID,
      }),
      expect.objectContaining({
        operation: 'update',
        stage: 'lookup',
        errorCode: 'ANNOTATION_NOT_FOUND',
      }),
    ]);
    expect(records.every((record) => record.context.annotationId === undefined)).toBe(true);
  });

  it('writes one safe terminal record per real read or persistence failure and exports it', async () => {
    const directory = createDirectory();
    const logger = new StructuredLogger({
      directory,
      now: () => new Date('2026-07-27T12:00:00.000Z'),
      createSessionId: () => 'annotation-session-test',
    });

    register(createService({
      findByEntry: () => {
        throw new Error(`${ERROR_CANARY} ${URL_CANARY} ${PATH_CANARY}`);
      },
    }), logger);
    expect(invoke(ANNOTATION_IPC_CHANNELS.list, { entryId: ENTRY_ID }))
      .toMatchObject({ ok: false, error: { code: 'ANNOTATION_UNKNOWN_ERROR' } });

    register(createService({
      create: () => {
        throw new Error(`${ERROR_CANARY} ${ANNOTATION_CANARY}`);
      },
    }), logger);
    expect(invoke(ANNOTATION_IPC_CHANNELS.create, createRequest()))
      .toMatchObject({ ok: false, error: { code: 'ANNOTATION_UNKNOWN_ERROR' } });

    register(createService({
      updateNote: () => {
        throw new Error(`${ERROR_CANARY} ${ANCHOR_CANARY}`);
      },
    }), logger);
    expect(invoke(ANNOTATION_IPC_CHANNELS.updateNote, {
      annotationId: ANNOTATION_ID,
      noteText: ANNOTATION_CANARY,
    })).toMatchObject({ ok: false, error: { code: 'ANNOTATION_UNKNOWN_ERROR' } });

    register(createService({
      delete: () => {
        throw new Error(`${ERROR_CANARY} ${PATH_CANARY}`);
      },
    }), logger);
    expect(invoke(ANNOTATION_IPC_CHANNELS.delete, { annotationId: ANNOTATION_ID }))
      .toMatchObject({ ok: false, error: { code: 'ANNOTATION_UNKNOWN_ERROR' } });

    await logger.flush();
    const files = readdirSync(directory).filter((name) => name.endsWith('.jsonl'));
    expect(files).toHaveLength(1);
    const jsonl = readFileSync(path.join(directory, files[0]), 'utf8');
    const records = jsonl.trim().split('\n').map((line) => JSON.parse(line));
    expect(records).toHaveLength(4);
    expect(records.map((record) => record.context)).toEqual([
      expect.objectContaining({
        operation: 'load',
        stage: 'read',
        errorCode: ANNOTATION_OPERATION_ERROR_CODES.readFailed,
        entryId: ENTRY_ID,
        durationMs: expect.any(Number),
        success: false,
      }),
      expect.objectContaining({
        operation: 'create',
        stage: 'persist',
        errorCode: ANNOTATION_OPERATION_ERROR_CODES.persistFailed,
        entryId: ENTRY_ID,
        durationMs: expect.any(Number),
        success: false,
      }),
      expect.objectContaining({
        operation: 'update',
        stage: 'persist',
        errorCode: ANNOTATION_OPERATION_ERROR_CODES.persistFailed,
        durationMs: expect.any(Number),
        success: false,
      }),
      expect.objectContaining({
        operation: 'delete',
        stage: 'persist',
        errorCode: ANNOTATION_OPERATION_ERROR_CODES.persistFailed,
        durationMs: expect.any(Number),
        success: false,
      }),
    ]);
    for (const canary of [
      URL_CANARY,
      ANNOTATION_CANARY,
      ANCHOR_CANARY,
      ERROR_CANARY,
      PATH_CANARY,
    ]) {
      expect(jsonl).not.toContain(canary);
    }
    expect(records.every((record) => record.context.annotationId === undefined)).toBe(true);

    const report = await createReport(directory);
    expect(report.logs.records).toHaveLength(4);
    expect(report.logs.records[0]).toMatchObject({
      event: ANNOTATION_LOG_EVENTS.operationFailed,
      component: 'annotation.operation',
      context: {
        operation: 'load',
        stage: 'read',
        errorCode: ANNOTATION_OPERATION_ERROR_CODES.readFailed,
        durationMs: expect.any(Number),
        success: false,
        entryId: ENTRY_ID,
      },
    });
    for (const canary of [
      URL_CANARY,
      ANNOTATION_CANARY,
      ANCHOR_CANARY,
      ERROR_CANARY,
      PATH_CANARY,
    ]) {
      expect(JSON.stringify(report)).not.toContain(canary);
    }
    expect(report.logs.records.every((record) => (
      !record.context || !Object.hasOwn(record.context, 'annotationId')
    ))).toBe(true);
  });
});
