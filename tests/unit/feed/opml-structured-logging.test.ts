import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StructuredLogger } from '../../../src/main/logging/StructuredLogger';
import {
  OPMLExportService,
  type OPMLExportFileOperations,
} from '../../../src/main/feed/services/OPMLExportService';
import {
  OPMLImportService,
  type OPMLFileReader,
} from '../../../src/main/feed/services/OPMLImportService';
import {
  logOPMLExportFailed,
  logOPMLImportFailed,
  OPML_LOG_COMPONENTS,
  OPML_LOG_ERROR_CODES,
  OPML_LOG_EVENTS,
  type OPMLExportCompletedLogContext,
  type OPMLExportFailedLogContext,
  type OPMLExportTempCleanupFailedLogContext,
  type OPMLImportCompletedLogContext,
  type OPMLImportFailedLogContext,
  type OPMLOperationLogger,
} from '../../../src/main/feed/services/OPMLLogging';
import type { FeedStore } from '../../../src/main/feed/stores/FeedStore';

const temporaryDirectories: string[] = [];

const FEED_TITLE_CANARY = 'OPML_FEED_TITLE_CANARY_MUST_NOT_BE_LOGGED';
const FEED_URL_CANARY = 'https://opml-feed-url-canary.example.test/private';
const FILE_PATH_CANARY = '/private/opml-target-path-canary.opml';
const XML_CANARY = 'OPML_XML_CANARY_MUST_NOT_BE_LOGGED';
const ERROR_CANARY = 'OPML_ERROR_CANARY_MUST_NOT_BE_LOGGED';

const VALID_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><body>
  <outline title="${FEED_TITLE_CANARY}" xmlUrl="${FEED_URL_CANARY}"/>
  <outline title="Second feed" xmlUrl="https://second.example.test/feed.xml"/>
</body></opml>`;

interface OPMLLogRecord {
  level: 'info' | 'warn' | 'error';
  event: string;
  component: string;
  context:
    | OPMLImportCompletedLogContext
    | OPMLImportFailedLogContext
    | OPMLExportCompletedLogContext
    | OPMLExportFailedLogContext
    | OPMLExportTempCleanupFailedLogContext;
}

function createLoggerSpy(): {
  logger: OPMLOperationLogger;
  records: OPMLLogRecord[];
} {
  const records: OPMLLogRecord[] = [];
  return {
    logger: {
      info: (event, component, context) => {
        records.push({ level: 'info', event, component, context });
      },
      warn: (event, component, context) => {
        records.push({ level: 'warn', event, component, context });
      },
      error: (event, component, context) => {
        records.push({ level: 'error', event, component, context });
      },
    },
    records,
  };
}

function createImportFeedStore(options: {
  existingUrls?: string[];
  create?: (params: { title?: string; feedURL: string; siteURL?: string }) => void;
  findAll?: () => Array<{ feedURL: string }>;
  deleteAllExcept?: () => void;
} = {}): FeedStore {
  return {
    findAll: vi.fn(options.findAll ?? (() => (
      (options.existingUrls ?? []).map((feedURL) => ({ feedURL }))
    ))),
    findByUrl: vi.fn(() => undefined),
    create: vi.fn((params: { title?: string; feedURL: string; siteURL?: string }) => (
      options.create?.(params)
    )),
    deleteAllExcept: vi.fn(() => options.deleteAllExcept?.()),
  } as unknown as FeedStore;
}

function createImportService(options: {
  feedStore?: FeedStore;
  logger?: OPMLOperationLogger;
  readFile?: OPMLFileReader;
} = {}): OPMLImportService {
  return new OPMLImportService(
    options.feedStore ?? createImportFeedStore(),
    options.logger,
    options.readFile ?? (async () => VALID_OPML),
  );
}

function createExportFeedStore(
  feeds: Array<{ title?: string; feedURL: string; siteURL?: string }>,
): FeedStore {
  return {
    findAll: vi.fn(() => feeds),
  } as unknown as FeedStore;
}

function createFileOperations(overrides: Partial<OPMLExportFileOperations> = {}): OPMLExportFileOperations {
  return {
    writeFile: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createLogDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'shale-opml-log-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function expectSafeDuration(context: OPMLLogRecord['context']): void {
  expect(Number.isSafeInteger(context.durationMs)).toBe(true);
  expect(context.durationMs).toBeGreaterThanOrEqual(0);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('OPML structured logging', () => {
  it('records one import summary for successful, partial, failed, skipped, and empty imports', async () => {
    const scenarios = [
      {
        label: 'success',
        service: (logger: OPMLOperationLogger) => createImportService({ logger }),
        expected: { count: 2, successCount: 2, failureCount: 0 },
      },
      {
        label: 'partial',
        service: (logger: OPMLOperationLogger) => createImportService({
          logger,
          feedStore: createImportFeedStore({
            create: ({ feedURL }) => {
              if (feedURL.includes('second')) throw new Error(ERROR_CANARY);
            },
          }),
        }),
        expected: { count: 2, successCount: 1, failureCount: 1 },
      },
      {
        label: 'all item failures',
        service: (logger: OPMLOperationLogger) => createImportService({
          logger,
          feedStore: createImportFeedStore({
            create: () => {
              throw new Error(ERROR_CANARY);
            },
          }),
        }),
        expected: { count: 2, successCount: 0, failureCount: 2 },
      },
      {
        label: 'all skipped',
        service: (logger: OPMLOperationLogger) => createImportService({
          logger,
          feedStore: createImportFeedStore({
            existingUrls: [FEED_URL_CANARY, 'https://second.example.test/feed.xml'],
          }),
        }),
        expected: { count: 2, successCount: 0, failureCount: 0 },
      },
      {
        label: 'empty',
        service: (logger: OPMLOperationLogger) => createImportService({
          logger,
          readFile: async () => '<?xml version="1.0"?><opml><body></body></opml>',
        }),
        expected: { count: 0, successCount: 0, failureCount: 1 },
      },
    ];

    for (const scenario of scenarios) {
      const { logger, records } = createLoggerSpy();
      const result = await scenario.service(logger).importFromFile(FILE_PATH_CANARY, 'merge');

      expect(result.totalFound).toBe(scenario.expected.count);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        level: 'info',
        event: OPML_LOG_EVENTS.importCompleted,
        component: OPML_LOG_COMPONENTS.import,
        context: scenario.expected,
      });
      expectSafeDuration(records[0].context);
    }
  });

  it('records one read failure and preserves the original error object', async () => {
    const { logger, records } = createLoggerSpy();
    const readError = new Error(ERROR_CANARY);
    const service = createImportService({
      logger,
      readFile: async () => {
        throw readError;
      },
    });

    await expect(service.importFromFile(FILE_PATH_CANARY, 'merge')).rejects.toBe(readError);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 'error',
      event: OPML_LOG_EVENTS.importFailed,
      component: OPML_LOG_COMPONENTS.import,
      context: {
        stage: 'read',
        errorCode: OPML_LOG_ERROR_CODES.importReadFailed,
      },
    });
    expectSafeDuration(records[0].context);
  });

  it('classifies invalid, parse, and process import failures without inspecting error text', async () => {
    const scenarios = [
      {
        run: (logger: OPMLOperationLogger) => createImportService({
          logger,
          readFile: async () => 'not OPML',
        }).importFromFile(FILE_PATH_CANARY, 'merge'),
        stage: 'parse',
        errorCode: OPML_LOG_ERROR_CODES.importInvalid,
      },
      {
        run: (logger: OPMLOperationLogger) => {
          const service = createImportService({ logger });
          const parseError = Object.assign(new Error(ERROR_CANARY), {
            code: 'OPML_PARSE_FAILED',
          });
          vi.spyOn(service, 'importFromContent').mockRejectedValue(parseError);
          return service.importFromFile(FILE_PATH_CANARY, 'merge');
        },
        stage: 'parse',
        errorCode: OPML_LOG_ERROR_CODES.importParseFailed,
      },
      {
        run: (logger: OPMLOperationLogger) => createImportService({
          logger,
          feedStore: createImportFeedStore({
            findAll: () => {
              throw new Error(ERROR_CANARY);
            },
          }),
        }).importFromFile(FILE_PATH_CANARY, 'merge'),
        stage: 'process',
        errorCode: OPML_LOG_ERROR_CODES.importProcessFailed,
      },
    ] as const;

    for (const scenario of scenarios) {
      const { logger, records } = createLoggerSpy();

      await expect(scenario.run(logger)).rejects.toBeDefined();
      expect(records).toHaveLength(1);
      expect(records[0].context).toMatchObject({
        stage: scenario.stage,
        errorCode: scenario.errorCode,
      });
    }
  });

  it('never passes import failures or source canaries to a fake logger or JSONL', async () => {
    const directory = createLogDirectory();
    const structuredLogger = new StructuredLogger({
      directory,
      now: () => new Date('2026-07-21T12:00:00.000Z'),
      createSessionId: () => 'opml-import-session',
    });
    const failingStore = createImportFeedStore({
      create: () => {
        throw new Error(ERROR_CANARY);
      },
    });
    const fakeLogger = createLoggerSpy();
    const fakeService = createImportService({
      logger: fakeLogger.logger,
      feedStore: failingStore,
    });
    const jsonlService = createImportService({
      logger: structuredLogger,
      feedStore: failingStore,
    });

    await fakeService.importFromFile(FILE_PATH_CANARY, 'merge');
    await jsonlService.importFromFile(FILE_PATH_CANARY, 'merge');
    await structuredLogger.flush();

    const fileName = readdirSync(directory).find((name) => name.endsWith('.jsonl'));
    if (!fileName) throw new Error('Expected structured logger output');
    const jsonl = readFileSync(path.join(directory, fileName), 'utf8');
    const fakeLog = JSON.stringify(fakeLogger.records);
    for (const canary of [
      FEED_TITLE_CANARY,
      FEED_URL_CANARY,
      FILE_PATH_CANARY,
      ERROR_CANARY,
      VALID_OPML,
    ]) {
      expect(fakeLog).not.toContain(canary);
      expect(jsonl).not.toContain(canary);
    }
  });

  it('keeps import results and errors unchanged when the logger throws', async () => {
    const throwingLogger: OPMLOperationLogger = {
      info: () => {
        throw new Error(ERROR_CANARY);
      },
      warn: () => {
        throw new Error(ERROR_CANARY);
      },
      error: () => {
        throw new Error(ERROR_CANARY);
      },
    };
    const completed = await createImportService({ logger: throwingLogger }).importFromFile(
      FILE_PATH_CANARY,
      'merge',
    );
    const readError = new Error('ORIGINAL_READ_ERROR');
    const failed = createImportService({
      logger: throwingLogger,
      readFile: async () => {
        throw readError;
      },
    });

    expect(completed.totalFound).toBe(2);
    await expect(failed.importFromFile(FILE_PATH_CANARY, 'merge')).rejects.toBe(readError);
  });

  it('records one completed export with the feed count', async () => {
    const { logger, records } = createLoggerSpy();
    const service = new OPMLExportService(
      createExportFeedStore([
        { title: FEED_TITLE_CANARY, feedURL: FEED_URL_CANARY },
        { feedURL: 'https://second.example.test/feed.xml' },
      ]),
      logger,
      createFileOperations(),
    );

    await expect(service.exportToFile(FILE_PATH_CANARY)).resolves.toBeUndefined();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 'info',
      event: OPML_LOG_EVENTS.exportCompleted,
      component: OPML_LOG_COMPONENTS.export,
      context: { count: 2 },
    });
    expectSafeDuration(records[0].context);
  });

  it.each([
    {
      label: 'serialize',
      feedStore: {
        findAll: vi.fn(() => [{ feedURL: undefined }]),
      } as unknown as FeedStore,
      fileOperations: createFileOperations(),
      stage: 'serialize',
      errorCode: OPML_LOG_ERROR_CODES.exportSerializeFailed,
    },
    {
      label: 'write',
      feedStore: createExportFeedStore([{ feedURL: FEED_URL_CANARY }]),
      fileOperations: createFileOperations({
        writeFile: async () => {
          throw new Error(ERROR_CANARY);
        },
      }),
      stage: 'write',
      errorCode: OPML_LOG_ERROR_CODES.exportWriteFailed,
    },
    {
      label: 'rename',
      feedStore: createExportFeedStore([{ feedURL: FEED_URL_CANARY }]),
      fileOperations: createFileOperations({
        rename: async () => {
          throw new Error(ERROR_CANARY);
        },
      }),
      stage: 'rename',
      errorCode: OPML_LOG_ERROR_CODES.exportRenameFailed,
    },
  ] as const)('records one $label export failure', async ({ feedStore, fileOperations, stage, errorCode }) => {
    const { logger, records } = createLoggerSpy();
    const service = new OPMLExportService(feedStore, logger, fileOperations);
    await expect(service.exportToFile(FILE_PATH_CANARY)).rejects.toBeDefined();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 'error',
      event: OPML_LOG_EVENTS.exportFailed,
      component: OPML_LOG_COMPONENTS.export,
      context: { stage, errorCode },
    });
    expectSafeDuration(records[0].context);
  });

  it('logs cleanup only when cleanup fails and preserves the original export error', async () => {
    const { logger, records } = createLoggerSpy();
    const exportError = new Error(ERROR_CANARY);
    const service = new OPMLExportService(
      createExportFeedStore([{ feedURL: FEED_URL_CANARY }]),
      logger,
      createFileOperations({
        writeFile: async () => {
          throw exportError;
        },
        unlink: async () => {
          throw new Error('CLEANUP_ERROR_CANARY');
        },
      }),
    );

    await expect(service.exportToFile(FILE_PATH_CANARY)).rejects.toBe(exportError);
    expect(records).toHaveLength(2);
    expect(records[0].context).toMatchObject({
      stage: 'write',
      errorCode: OPML_LOG_ERROR_CODES.exportWriteFailed,
    });
    expect(records[1]).toMatchObject({
      level: 'warn',
      event: OPML_LOG_EVENTS.exportTempCleanupFailed,
      context: {
        stage: 'cleanup',
        errorCode: OPML_LOG_ERROR_CODES.exportTempCleanupFailed,
      },
    });
  });

  it('does not log a cleanup warning when cleanup succeeds', async () => {
    const { logger, records } = createLoggerSpy();
    const service = new OPMLExportService(
      createExportFeedStore([{ feedURL: FEED_URL_CANARY }]),
      logger,
      createFileOperations({
        writeFile: async () => {
          throw new Error(ERROR_CANARY);
        },
      }),
    );

    await expect(service.exportToFile(FILE_PATH_CANARY)).rejects.toBeDefined();
    expect(records).toHaveLength(1);
    expect(records[0].event).toBe(OPML_LOG_EVENTS.exportFailed);
  });

  it('never passes export canaries to a fake logger or JSONL', async () => {
    const directory = createLogDirectory();
    const structuredLogger = new StructuredLogger({
      directory,
      now: () => new Date('2026-07-21T12:00:00.000Z'),
      createSessionId: () => 'opml-export-session',
    });
    const feedStore = createExportFeedStore([
      { title: `${FEED_TITLE_CANARY}-${XML_CANARY}`, feedURL: FEED_URL_CANARY },
    ]);
    const failingOperations = createFileOperations({
      writeFile: async (_filePath, content) => {
        expect(content).toContain(FEED_TITLE_CANARY);
        expect(content).toContain(FEED_URL_CANARY);
        expect(content).toContain(XML_CANARY);
        throw new Error(ERROR_CANARY);
      },
    });
    const fakeLogger = createLoggerSpy();
    const fakeService = new OPMLExportService(feedStore, fakeLogger.logger, failingOperations);
    const jsonlService = new OPMLExportService(feedStore, structuredLogger, failingOperations);

    await expect(fakeService.exportToFile(FILE_PATH_CANARY)).rejects.toBeDefined();
    await expect(jsonlService.exportToFile(FILE_PATH_CANARY)).rejects.toBeDefined();
    await structuredLogger.flush();

    const fileName = readdirSync(directory).find((name) => name.endsWith('.jsonl'));
    if (!fileName) throw new Error('Expected structured logger output');
    const jsonl = readFileSync(path.join(directory, fileName), 'utf8');
    const fakeLog = JSON.stringify(fakeLogger.records);
    for (const canary of [
      FEED_TITLE_CANARY,
      FEED_URL_CANARY,
      FILE_PATH_CANARY,
      ERROR_CANARY,
      XML_CANARY,
    ]) {
      expect(fakeLog).not.toContain(canary);
      expect(jsonl).not.toContain(canary);
    }
  });

  it('keeps export success and failures unchanged when the logger throws', async () => {
    const throwingLogger: OPMLOperationLogger = {
      info: () => {
        throw new Error(ERROR_CANARY);
      },
      warn: () => {
        throw new Error(ERROR_CANARY);
      },
      error: () => {
        throw new Error(ERROR_CANARY);
      },
    };
    const success = new OPMLExportService(
      createExportFeedStore([{ feedURL: FEED_URL_CANARY }]),
      throwingLogger,
      createFileOperations(),
    );
    const exportError = new Error('ORIGINAL_EXPORT_ERROR');
    const failure = new OPMLExportService(
      createExportFeedStore([{ feedURL: FEED_URL_CANARY }]),
      throwingLogger,
      createFileOperations({
        writeFile: async () => {
          throw exportError;
        },
      }),
    );

    await expect(success.exportToFile(FILE_PATH_CANARY)).resolves.toBeUndefined();
    await expect(failure.exportToFile(FILE_PATH_CANARY)).rejects.toBe(exportError);
  });

  it('drops invalid runtime OPML failure combinations before calling the logger', () => {
    const { logger, records } = createLoggerSpy();
    logOPMLImportFailed(logger, {
      durationMs: 0,
      stage: 'write' as OPMLImportFailedLogContext['stage'],
      errorCode: OPML_LOG_ERROR_CODES.importReadFailed,
    });
    logOPMLExportFailed(logger, {
      durationMs: 0,
      stage: 'write',
      errorCode: OPML_LOG_ERROR_CODES.exportSerializeFailed,
    } as OPMLExportFailedLogContext);

    expect(records).toEqual([]);
  });
});
