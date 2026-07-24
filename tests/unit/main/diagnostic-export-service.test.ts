import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DIAGNOSTIC_LOG_READ_ISSUE_CODES,
  DIAGNOSTIC_LOG_SCHEMA_VERSION,
  DIAGNOSTIC_REPORT_VERSION,
  type DiagnosticRuntimeInfo,
} from '../../../src/shared/contracts/diagnostics.types';
import {
  DiagnosticExportError,
  DiagnosticExportService,
  MAX_DIAGNOSTIC_LOG_RECORDS,
  createDiagnosticFileName,
  type DiagnosticExportFileOperations,
} from '../../../src/main/diagnostics/DiagnosticExportService';
import { STRUCTURED_LOG_SCHEMA_VERSION } from '../../../src/main/logging/StructuredLogger';

const temporaryDirectories: string[] = [];
const GENERATED_AT = new Date('2026-07-24T08:00:00.000Z');

afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createDirectory(prefix = 'shale-diagnostic-export-'): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function createRuntime(
  overrides: Partial<DiagnosticRuntimeInfo> = {},
): DiagnosticRuntimeInfo {
  return {
    applicationVersion: '0.2.4',
    electronVersion: '43.1.0',
    nodeVersion: '24.11.1',
    operatingSystem: 'linux',
    operatingSystemRelease: '6.12.0',
    architecture: 'x64',
    isPackaged: false,
    display: {
      session: 'wayland',
      waylandDetected: true,
      ozonePlatform: 'wayland',
    },
    ...overrides,
  };
}

function createService(
  logDirectory: string,
  overrides: Partial<ConstructorParameters<typeof DiagnosticExportService>[0]> = {},
): DiagnosticExportService {
  return new DiagnosticExportService({
    logDirectory,
    runtime: createRuntime(),
    now: () => GENERATED_AT,
    createTemporaryName: () => 'temporary-file-id',
    ...overrides,
  });
}

function record(
  timestamp: string,
  count: number,
  context: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    schemaVersion: STRUCTURED_LOG_SCHEMA_VERSION,
    timestamp,
    level: 'info',
    event: 'feed.sync.run.completed',
    component: 'feed.sync',
    sessionId: 'session-test-1',
    context: { count, ...context },
  });
}

function writeLogFile(directory: string, name: string, lines: string[]): void {
  writeFileSync(path.join(directory, name), `${lines.join('\n')}\n`, 'utf8');
}

describe('DiagnosticExportService', () => {
  it('builds a versioned report with valid records in chronological order', async () => {
    const logDirectory = createDirectory();
    writeLogFile(logDirectory, 'structured-2026-07-23.jsonl', [
      record('2026-07-23T09:00:00.000Z', 2),
    ]);
    writeLogFile(logDirectory, 'structured-2026-07-24.jsonl', [
      record('2026-07-23T08:00:00.000Z', 1),
    ]);

    const report = await createService(logDirectory).buildReport();

    expect(report).toMatchObject({
      reportVersion: DIAGNOSTIC_REPORT_VERSION,
      generatedAt: GENERATED_AT.toISOString(),
      application: {
        name: 'Shale',
        version: '0.2.4',
        isPackaged: false,
      },
      runtime: {
        electronVersion: '43.1.0',
        nodeVersion: '24.11.1',
        operatingSystem: 'linux',
        operatingSystemRelease: '6.12.0',
        architecture: 'x64',
        display: {
          session: 'wayland',
          waylandDetected: true,
          ozonePlatform: 'wayland',
        },
      },
      logs: {
        format: 'structured-jsonl',
        schemaVersion: DIAGNOSTIC_LOG_SCHEMA_VERSION,
        status: 'complete',
        omittedValidRecordCount: 0,
        issues: [],
      },
    });
    expect(report.logs.records.map((entry) => entry.context?.count)).toEqual([1, 2]);
  });

  it('exports the latest 1,000 valid records while preserving chronological order', async () => {
    const logDirectory = createDirectory();
    const lines = Array.from({ length: MAX_DIAGNOSTIC_LOG_RECORDS + 2 }, (_, index) => record(
      new Date(Date.UTC(2026, 6, 20, 0, 0, index)).toISOString(),
      index,
    ));
    writeLogFile(logDirectory, 'structured-2026-07-20.jsonl', lines);

    const report = await createService(logDirectory).buildReport();

    expect(report.logs.records).toHaveLength(MAX_DIAGNOSTIC_LOG_RECORDS);
    expect(report.logs.omittedValidRecordCount).toBe(2);
    expect(report.logs.records[0].context?.count).toBe(2);
    expect(report.logs.records.at(-1)?.context?.count).toBe(
      MAX_DIAGNOSTIC_LOG_RECORDS + 1,
    );
  });

  it('reports an empty log directory without treating it as an error', async () => {
    const report = await createService(createDirectory()).buildReport();

    expect(report.logs).toEqual({
      format: 'structured-jsonl',
      schemaVersion: DIAGNOSTIC_LOG_SCHEMA_VERSION,
      status: 'complete',
      omittedValidRecordCount: 0,
      issues: [],
      records: [],
    });
  });

  it('reports damaged and unreadable logs by stable aggregate codes only', async () => {
    const logDirectory = createDirectory();
    writeLogFile(logDirectory, 'structured-2026-07-23.jsonl', ['not valid json']);
    const readFailure = '读取失败\n/Users/alice/private/log.jsonl';
    const operations: DiagnosticExportFileOperations = {
      readDirectory: async () => [
        { name: 'structured-2026-07-23.jsonl', isFile: () => true },
        { name: 'structured-2026-07-24.jsonl', isFile: () => true },
      ],
      readFile: async (filePath) => {
        if (filePath.endsWith('2026-07-24.jsonl')) throw new Error(readFailure);
        return readFileSync(filePath, 'utf8');
      },
      writeFile: async () => undefined,
      rename: async () => undefined,
      unlink: async () => undefined,
    };

    const report = await createService(logDirectory, { fileOperations: operations }).buildReport();

    expect(report.logs).toMatchObject({
      status: 'partial',
      records: [],
      issues: [
        { code: DIAGNOSTIC_LOG_READ_ISSUE_CODES.fileReadFailed, count: 1 },
        { code: DIAGNOSTIC_LOG_READ_ISSUE_CODES.recordMalformed, count: 1 },
      ],
    });
    expect(JSON.stringify(report)).not.toContain(readFailure);
    expect(JSON.stringify(report)).not.toContain('/Users/alice');
  });

  it('returns an unavailable status when the log directory cannot be read', async () => {
    const directoryFailure = '目录错误\n/private/var/folders/secret';
    const operations: DiagnosticExportFileOperations = {
      readDirectory: async () => { throw new Error(directoryFailure); },
      readFile: async () => '',
      writeFile: async () => undefined,
      rename: async () => undefined,
      unlink: async () => undefined,
    };

    const report = await createService(createDirectory(), { fileOperations: operations }).buildReport();

    expect(report.logs).toEqual({
      format: 'structured-jsonl',
      schemaVersion: DIAGNOSTIC_LOG_SCHEMA_VERSION,
      status: 'unavailable',
      omittedValidRecordCount: 0,
      issues: [{ code: DIAGNOSTIC_LOG_READ_ISSUE_CODES.directoryUnavailable, count: 1 }],
      records: [],
    });
    expect(JSON.stringify(report)).not.toContain(directoryFailure);
  });

  it('redacts malformed, free-text, credential, URL, content, and path fields a second time', async () => {
    const logDirectory = createDirectory();
    const canaries = [
      'API_KEY_CANARY',
      'Bearer TOKEN_CANARY',
      'https://feed.example.test/rss?token=QUERY_CANARY',
      '/Users/alice/article.md',
      '文章正文\n第二行',
      '摘要全文',
      '翻译全文',
      '用户笔记',
    ];
    writeLogFile(logDirectory, 'structured-2026-07-24.jsonl', [JSON.stringify({
      schemaVersion: STRUCTURED_LOG_SCHEMA_VERSION,
      timestamp: '2026-07-24T07:59:00.000Z',
      level: 'error',
      event: 'content.pipeline.failed',
      component: 'content.pipeline',
      sessionId: 'session-test-2',
      context: {
        entryId: 8,
        errorCode: 'CONTENT_FETCH_FAILED',
        apiKey: canaries[0],
        authorization: canaries[1],
        sourceUrl: canaries[2],
        filePath: canaries[3],
        markdown: canaries[4],
        summary: canaries[5],
        translation: canaries[6],
        note: canaries[7],
        message: '中文错误\n第二行',
      },
      rawArticle: canaries[4],
    })]);

    const report = await createService(logDirectory).buildReport();
    const serialized = JSON.stringify(report);

    expect(report.logs.records).toEqual([
      expect.objectContaining({
        context: { entryId: 8, errorCode: 'CONTENT_FETCH_FAILED' },
      }),
    ]);
    for (const canary of canaries) {
      expect(serialized).not.toContain(canary);
    }
    expect(serialized).not.toContain('中文错误');
  });

  it('uses null for missing runtime fields without changing the stable report shape', async () => {
    const report = await createService(createDirectory(), {
      runtime: createRuntime({
        applicationVersion: null,
        electronVersion: null,
        nodeVersion: null,
        operatingSystem: null,
        operatingSystemRelease: null,
        architecture: null,
        isPackaged: null,
      }),
    }).buildReport();

    expect(report.application.version).toBeNull();
    expect(report.application.isPackaged).toBeNull();
    expect(report.runtime).toMatchObject({
      electronVersion: null,
      nodeVersion: null,
      operatingSystem: null,
      operatingSystemRelease: null,
      architecture: null,
    });
  });

  it('writes one diagnostic JSON file without changing the source log bytes or using the network', async () => {
    const logDirectory = createDirectory();
    const logPath = path.join(logDirectory, 'structured-2026-07-24.jsonl');
    writeLogFile(logDirectory, path.basename(logPath), [
      record('2026-07-24T07:59:00.000Z', 1),
    ]);
    const originalLogBytes = readFileSync(logPath);
    const targetPath = path.join(logDirectory, 'diagnostic.json');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await createService(logDirectory).exportToFile(targetPath);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(readFileSync(logPath)).toEqual(originalLogBytes);
    expect(JSON.parse(readFileSync(targetPath, 'utf8'))).toMatchObject({
      reportVersion: DIAGNOSTIC_REPORT_VERSION,
      logs: { records: [expect.any(Object)] },
    });
    expect(readdirSync(logDirectory).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('does not leave a target file when writing fails and exposes only a stable error', async () => {
    const logDirectory = createDirectory();
    const targetPath = path.join(logDirectory, 'diagnostic.json');
    const unlink = vi.fn(async () => undefined);
    const operations: DiagnosticExportFileOperations = {
      readDirectory: async () => [],
      readFile: async () => '',
      writeFile: async () => { throw new Error('权限错误\n/Users/alice/private'); },
      rename: async () => undefined,
      unlink,
    };

    await expect(createService(logDirectory, { fileOperations: operations }).exportToFile(targetPath))
      .rejects.toMatchObject({ code: 'DIAGNOSTIC_EXPORT_WRITE_FAILED' } satisfies Partial<DiagnosticExportError>);

    expect(existsSync(targetPath)).toBe(false);
    expect(unlink).toHaveBeenCalledOnce();
  });

  it('creates a Windows-safe default file name', () => {
    expect(createDiagnosticFileName(GENERATED_AT)).toBe('shale-diagnostics-20260724T080000Z.json');
  });
});
