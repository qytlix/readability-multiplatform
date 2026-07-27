import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXPORT_IPC_CHANNELS } from '../../../src/shared/contracts/export.ipc';
import type {
  ExportableArticle,
  PerArticleOptions,
} from '../../../src/shared/contracts/export.types';

const captured = vi.hoisted(() => ({
  authorized: true,
  handlers: new Map<string, (event: unknown, request: unknown) => Promise<unknown>>(),
  showSaveDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/private/markdown-export-test-documents',
  },
  dialog: {
    showSaveDialog: captured.showSaveDialog,
  },
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, request: unknown) => Promise<unknown>,
    ) => {
      captured.handlers.set(channel, handler);
    },
  },
}));

vi.mock('../../../src/main/ipc', () => ({
  isAuthorizedSender: () => captured.authorized,
}));

import { DiagnosticExportService } from '../../../src/main/diagnostics/DiagnosticExportService';
import type { ExportService } from '../../../src/main/export/ExportService';
import {
  MARKDOWN_EXPORT_LOG_ERROR_CODES,
  MARKDOWN_EXPORT_LOG_EVENTS,
} from '../../../src/main/export/MarkdownExportLogging';
import { registerExportIpcHandlers } from '../../../src/main/ipc/export.handler';
import { StructuredLogger } from '../../../src/main/logging/StructuredLogger';

const temporaryDirectories: string[] = [];
const FILE_PATH_CANARY = '/Users/alice/private/Markdown_Path_CANARY.md';
const ARTICLE_TITLE_CANARY = 'ARTICLE_TITLE_CANARY_MUST_NOT_BE_LOGGED';
const ARTICLE_URL_CANARY = 'https://article-url-canary.example.test/private';
const ARTICLE_MARKDOWN_CANARY = 'ARTICLE_MARKDOWN_CANARY_MUST_NOT_BE_LOGGED';
const WRITE_ERROR_CANARY = 'WRITE_ERROR_CANARY_MUST_NOT_BE_LOGGED';
const options: PerArticleOptions = {
  includeSummary: false,
  includeTranslation: false,
  includeNotes: false,
};

function createDirectory(prefix = 'shale-markdown-export-log-'): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function createArticle(entryId = 1): ExportableArticle {
  return {
    entryId,
    title: ARTICLE_TITLE_CANARY,
    url: ARTICLE_URL_CANARY,
    cleanedMarkdown: ARTICLE_MARKDOWN_CANARY,
    exportOptions: options,
  };
}

function createExportService(overrides: Partial<ExportService> = {}): ExportService {
  return {
    prepareArticleData: vi.fn(() => createArticle()),
    prepareMultipleArticleData: vi.fn((entries: Array<{ entryId: number }>) => (
      entries.map(({ entryId }) => createArticle(entryId))
    )),
    writeMarkdownExport: vi.fn(async () => ({
      markdown: '',
      downloadedImageCount: 0,
      failedImageCount: 0,
    })),
    ...overrides,
  } as unknown as ExportService;
}

function createLogger(directory: string): StructuredLogger {
  return new StructuredLogger({
    directory,
    now: () => new Date('2026-07-27T12:00:00.000Z'),
    createSessionId: () => 'markdown-export-log-test',
  });
}

function readRecords(directory: string): Array<Record<string, unknown>> {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) => readFileSync(path.join(directory, name), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>));
}

function register(service: ExportService, logger: StructuredLogger): void {
  registerExportIpcHandlers(() => null, service, logger);
}

async function invoke(channel: string, request: unknown): Promise<unknown> {
  const handler = captured.handlers.get(channel);
  if (!handler) throw new Error(`Missing handler for ${channel}`);
  return handler({}, request);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

beforeEach(() => {
  captured.authorized = true;
  captured.handlers.clear();
  captured.showSaveDialog.mockReset();
});

describe('Markdown export structured logging', () => {
  it('writes one completed JSONL record and retains its safe fields in the diagnostic export', async () => {
    const logDirectory = createDirectory();
    const diagnosticPath = path.join(createDirectory('shale-markdown-diagnostic-'), 'report.json');
    const logger = createLogger(logDirectory);
    const service = createExportService();
    captured.showSaveDialog.mockResolvedValue({ canceled: false, filePath: FILE_PATH_CANARY });
    register(service, logger);

    await expect(invoke(EXPORT_IPC_CHANNELS.exportSingle, { entryId: 1, options })).resolves
      .toMatchObject({ ok: true });
    await logger.flush();

    const records = readRecords(logDirectory);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 'info',
      event: MARKDOWN_EXPORT_LOG_EVENTS.completed,
      component: 'markdown.export',
      context: { count: 1 },
    });
    expect((records[0].context as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);

    const exporter = new DiagnosticExportService({
      logDirectory,
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
      createTemporaryName: () => 'markdown-export-diagnostics',
    });
    await exporter.exportToFile(diagnosticPath);
    const report = JSON.parse(readFileSync(diagnosticPath, 'utf8')) as {
      logs: { records: Array<{ event: string; context?: Record<string, unknown> }> };
    };
    expect(report.logs.records).toEqual([
      expect.objectContaining({
        event: MARKDOWN_EXPORT_LOG_EVENTS.completed,
        context: expect.objectContaining({
          count: 1,
          durationMs: expect.any(Number),
        }),
      }),
    ]);

    const serialized = JSON.stringify({ records, report });
    for (const canary of [
      FILE_PATH_CANARY,
      ARTICLE_TITLE_CANARY,
      ARTICLE_URL_CANARY,
      ARTICLE_MARKDOWN_CANARY,
    ]) {
      expect(serialized).not.toContain(canary);
    }
  });

  it('writes one stable failed JSONL record without a path, content, or raw write error', async () => {
    const logDirectory = createDirectory();
    const logger = createLogger(logDirectory);
    const service = createExportService({
      writeMarkdownExport: vi.fn(async () => {
        throw new Error(WRITE_ERROR_CANARY);
      }),
    });
    captured.showSaveDialog.mockResolvedValue({ canceled: false, filePath: FILE_PATH_CANARY });
    register(service, logger);

    await expect(invoke(EXPORT_IPC_CHANNELS.exportSingle, { entryId: 1, options })).resolves
      .toMatchObject({
        ok: false,
        error: { code: 'EXPORT_WRITE_FAILED' },
      });
    await logger.flush();

    const records = readRecords(logDirectory);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 'error',
      event: MARKDOWN_EXPORT_LOG_EVENTS.failed,
      component: 'markdown.export',
      context: {
        count: 1,
        stage: 'write',
        errorCode: MARKDOWN_EXPORT_LOG_ERROR_CODES.writeFailed,
      },
    });
    const serialized = JSON.stringify(records);
    for (const canary of [
      FILE_PATH_CANARY,
      ARTICLE_TITLE_CANARY,
      ARTICLE_URL_CANARY,
      ARTICLE_MARKDOWN_CANARY,
      WRITE_ERROR_CANARY,
    ]) {
      expect(serialized).not.toContain(canary);
    }
  });

  it('does not write a file or an export failure record when the user cancels', async () => {
    const logDirectory = createDirectory();
    const logger = createLogger(logDirectory);
    const service = createExportService();
    captured.showSaveDialog.mockResolvedValue({ canceled: true });
    register(service, logger);

    await expect(invoke(EXPORT_IPC_CHANNELS.exportSingle, { entryId: 1, options })).resolves
      .toMatchObject({
        ok: false,
        error: { code: 'EXPORT_SAVE_CANCELED' },
      });
    await logger.flush();

    expect(service.writeMarkdownExport).not.toHaveBeenCalled();
    expect(readRecords(logDirectory)).toEqual([]);
  });

  it('writes one completed record for a multi-article document export', async () => {
    const logDirectory = createDirectory();
    const logger = createLogger(logDirectory);
    const service = createExportService({
      writeMarkdownExport: vi.fn(async () => ({
        markdown: '',
        downloadedImageCount: 1,
        failedImageCount: 1,
      })),
    });
    captured.showSaveDialog.mockResolvedValue({ canceled: false, filePath: FILE_PATH_CANARY });
    register(service, logger);

    await expect(invoke(EXPORT_IPC_CHANNELS.exportMultiple, {
      entries: [
        { entryId: 1, options },
        { entryId: 2, options },
      ],
    })).resolves.toMatchObject({ ok: true });
    await logger.flush();

    expect(readRecords(logDirectory)).toEqual([
      expect.objectContaining({
        event: MARKDOWN_EXPORT_LOG_EVENTS.completed,
        context: expect.objectContaining({ count: 2 }),
      }),
    ]);
  });
});
