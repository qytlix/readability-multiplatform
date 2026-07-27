import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CleanedContent,
  CleanResult,
  FetchResult,
} from '../../../src/shared/contracts/content.types';
import type { Entry } from '../../../src/shared/contracts/feed.types';
import { DiagnosticExportService } from '../../../src/main/diagnostics/DiagnosticExportService';
import { StructuredLogger } from '../../../src/main/logging/StructuredLogger';
import {
  ContentCleaner,
  ContentExtractionError,
} from '../../../src/main/feed/fetcher/ContentCleaner';
import { ContentFetcher } from '../../../src/main/feed/fetcher/ContentFetcher';
import { FetchResponseUnavailableError } from '../../../src/main/feed/fetcher/FetchStrategy';
import { MarkdownConverter } from '../../../src/main/feed/fetcher/MarkdownConverter';
import {
  CONTENT_LOG_COMPONENTS,
  CONTENT_LOG_EVENTS,
  CONTENT_PIPELINE_ERROR_CODES,
  logContentPipelineFailure,
  type ContentLogContext,
  type ContentOperationLogger,
  type ContentSuccessLogContext,
} from '../../../src/main/feed/services/ContentLogging';
import { ContentService } from '../../../src/main/feed/services/ContentService';
import type { ContentStore } from '../../../src/main/feed/stores/ContentStore';
import type { EntryStore } from '../../../src/main/feed/stores/EntryStore';

const temporaryDirectories: string[] = [];

const ARTICLE_URL = 'https://article-url-canary.example.test/path?query=private';
const ENTRY_TITLE = 'ENTRY_TITLE_CANARY_MUST_NOT_BE_LOGGED';
const ENTRY_AUTHOR = 'AUTHOR_CANARY_MUST_NOT_BE_LOGGED';

const TEST_ENTRY: Entry = {
  id: 41,
  feedId: 12,
  guid: 'entry-guid',
  url: ARTICLE_URL,
  title: ENTRY_TITLE,
  author: ENTRY_AUTHOR,
  isRead: false,
  readingProgress: 0,
  isStarred: false,
  isDeleted: false,
  createdAt: '2026-07-21T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
};

const RAW_HTML_CANARY = 'RAW_HTML_CANARY_MUST_NOT_BE_LOGGED';
const CLEANED_HTML_CANARY = 'CLEANED_HTML_CANARY_MUST_NOT_BE_LOGGED';
const MARKDOWN_CANARY = 'MARKDOWN_CANARY_MUST_NOT_BE_LOGGED';
const PIPELINE_ERROR_CANARY = 'PIPELINE_ERROR_CANARY_MUST_NOT_BE_LOGGED';
const HEADER_CANARY = 'HEADER_CANARY_MUST_NOT_BE_LOGGED';
const DOCUMENT_BASE_URL_CANARY = 'DOCUMENT_BASE_URL_CANARY_MUST_NOT_BE_LOGGED';

interface ContentLogRecord {
  event: string;
  component: string;
  context: ContentLogContext | ContentSuccessLogContext;
}

function createContentLoggerSpy(): {
  logger: ContentOperationLogger;
  records: ContentLogRecord[];
} {
  const records: ContentLogRecord[] = [];
  return {
    logger: {
      info: (event, component, context) => {
        records.push({ event, component, context });
      },
      error: (event, component, context) => {
        records.push({ event, component, context });
      },
    },
    records,
  };
}

function createFetchResult(): FetchResult {
  return {
    url: ARTICLE_URL,
    statusCode: 200,
    headers: { authorization: HEADER_CANARY },
    body: RAW_HTML_CANARY,
  };
}

function createCleanResult(): CleanResult {
  return {
    title: ENTRY_TITLE,
    byline: ENTRY_AUTHOR,
    content: `${CLEANED_HTML_CANARY} ${MARKDOWN_CANARY}`,
    documentBaseURL: `https://${DOCUMENT_BASE_URL_CANARY}.example.test`,
  };
}

function createContentService(options: {
  entry?: Entry;
  logger?: ContentOperationLogger;
  fetch?: (
    url: string,
    signal?: AbortSignal,
    validate?: (candidate: FetchResult) => void | Promise<void>,
  ) => Promise<FetchResult>;
  clean?: () => CleanResult;
  cleanFeed?: () => CleanResult;
  convert?: () => string;
  upsert?: (params: { pipelineStatus: string }) => void;
  updatePipelineStatus?: () => void;
  lookup?: () => Entry | undefined;
  cachedContent?: CleanedContent | undefined;
  feedFallbackHtml?: string | undefined;
} = {}): {
  service: ContentService;
  contentStore: {
    findByEntry: ReturnType<typeof vi.fn>;
    updatePipelineStatus: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
} {
  const contentStore = {
    findByEntry: vi.fn(() => options.cachedContent),
    updatePipelineStatus: vi.fn(() => options.updatePipelineStatus?.()),
    upsert: vi.fn((params: { pipelineStatus: string }) => options.upsert?.(params)),
  };
  const entryStore = {
    findById: vi.fn(options.lookup ?? (() => options.entry ?? TEST_ENTRY)),
    findFeedContentHtml: vi.fn(() => options.feedFallbackHtml),
    createOrUpdate: vi.fn(),
  };
  const fetcher = {
    fetch: vi.fn(options.fetch ?? (async () => createFetchResult())),
  };
  const cleaner = {
    clean: vi.fn(options.clean ?? (() => createCleanResult())),
    cleanFeedContent: vi.fn(options.cleanFeed ?? (() => createCleanResult())),
  };
  const markdownConverter = {
    convert: vi.fn(options.convert ?? (() => MARKDOWN_CANARY)),
  };

  return {
    service: new ContentService(
      contentStore as unknown as ContentStore,
      entryStore as unknown as EntryStore,
      fetcher as unknown as ContentFetcher,
      cleaner as unknown as ContentCleaner,
      markdownConverter as unknown as MarkdownConverter,
      options.logger,
    ),
    contentStore,
  };
}

function expectOneFailure(
  records: ContentLogRecord[],
  expected: {
    entryId: number;
    feedId?: number;
    stage: ContentLogContext['stage'];
    errorCode: ContentLogContext['errorCode'];
  },
): void {
  expect(records).toHaveLength(1);
  expect(records[0]).toEqual({
    event: CONTENT_LOG_EVENTS.pipelineFailed,
    component: CONTENT_LOG_COMPONENTS.pipeline,
    context: expect.objectContaining({
      ...expected,
      success: false,
    }),
  });
  const durationMs = records[0].context.durationMs;
  expect(Number.isSafeInteger(durationMs)).toBe(true);
  expect(durationMs).toBeGreaterThanOrEqual(0);
}

function createLogDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'shale-content-log-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Content structured logging', () => {
  it('logs safe stage durations for a successful Content pipeline', async () => {
    const { logger, records } = createContentLoggerSpy();
    const { service } = createContentService({ logger });

    const result = await service.fetchAndClean(TEST_ENTRY.id);

    expect(result.pipelineStatus).toBe('success');
    expect(records).toEqual([
      {
        event: CONTENT_LOG_EVENTS.pipelineCompleted,
        component: CONTENT_LOG_COMPONENTS.pipeline,
        context: expect.objectContaining({
          entryId: TEST_ENTRY.id,
          feedId: TEST_ENTRY.feedId,
          success: true,
          durationMs: expect.any(Number),
          fetchDurationMs: expect.any(Number),
          cleanDurationMs: expect.any(Number),
          convertDurationMs: expect.any(Number),
          persistDurationMs: expect.any(Number),
        }),
      },
    ]);
  });

  it('records an Entry-not-found failure without fabricating a feed ID', async () => {
    const { logger, records } = createContentLoggerSpy();
    const { service } = createContentService({
      logger,
      lookup: () => undefined,
    });

    const result = await service.fetchAndClean(999);

    expect(result).toEqual({
      entryId: 999,
      sourceUrl: '',
      cleanedHtml: '',
      markdown: '',
      pipelineStatus: 'failed',
      pipelineError: 'Entry not found',
    });
    expectOneFailure(records, {
      entryId: 999,
      stage: 'lookup',
      errorCode: CONTENT_PIPELINE_ERROR_CODES.entryNotFound,
    });
    expect(records[0].context.feedId).toBeUndefined();
  });

  it('rethrows the original Entry lookup error after recording one lookup failure', async () => {
    const { logger, records } = createContentLoggerSpy();
    const lookupError = new Error(PIPELINE_ERROR_CANARY);
    const { service } = createContentService({
      logger,
      lookup: () => {
        throw lookupError;
      },
    });

    await expect(service.fetchAndClean(TEST_ENTRY.id)).rejects.toBe(lookupError);
    expectOneFailure(records, {
      entryId: TEST_ENTRY.id,
      stage: 'lookup',
      errorCode: CONTENT_PIPELINE_ERROR_CODES.lookupFailed,
    });
    expect(records[0].context.feedId).toBeUndefined();
  });

  it('records a missing Entry URL failure with its existing feed ID', async () => {
    const { logger, records } = createContentLoggerSpy();
    const { service } = createContentService({
      entry: { ...TEST_ENTRY, url: undefined },
      logger,
    });

    const result = await service.fetchAndClean(TEST_ENTRY.id);

    expect(result.pipelineError).toBe('Entry has no URL');
    expectOneFailure(records, {
      entryId: TEST_ENTRY.id,
      feedId: TEST_ENTRY.feedId,
      stage: 'validate',
      errorCode: CONTENT_PIPELINE_ERROR_CODES.entryUrlMissing,
    });
  });

  it.each([
    {
      label: 'fetch',
      stage: 'fetch' as const,
      errorCode: CONTENT_PIPELINE_ERROR_CODES.fetchFailed,
      configure: (logger: ContentOperationLogger) => createContentService({
        logger,
        fetch: async () => {
          throw new Error(PIPELINE_ERROR_CANARY);
        },
      }),
    },
    {
      label: 'clean',
      stage: 'clean' as const,
      errorCode: CONTENT_PIPELINE_ERROR_CODES.cleanFailed,
      configure: (logger: ContentOperationLogger) => createContentService({
        logger,
        clean: () => {
          throw new Error(PIPELINE_ERROR_CANARY);
        },
      }),
    },
    {
      label: 'convert',
      stage: 'convert' as const,
      errorCode: CONTENT_PIPELINE_ERROR_CODES.convertFailed,
      configure: (logger: ContentOperationLogger) => createContentService({
        logger,
        convert: () => {
          throw new Error(PIPELINE_ERROR_CANARY);
        },
      }),
    },
    {
      label: 'persist',
      stage: 'persist' as const,
      errorCode: CONTENT_PIPELINE_ERROR_CODES.persistFailed,
      configure: (logger: ContentOperationLogger) => createContentService({
        logger,
        upsert: ({ pipelineStatus }) => {
          if (pipelineStatus === 'success') {
            throw new Error(PIPELINE_ERROR_CANARY);
          }
        },
      }),
    },
  ])('records exactly one safe $label failure', async ({ stage, errorCode, configure }) => {
    const { logger, records } = createContentLoggerSpy();
    const { service } = configure(logger);

    const result = await service.fetchAndClean(TEST_ENTRY.id);

    expect(result.pipelineStatus).toBe('failed');
    expect(result.pipelineError).toBe(PIPELINE_ERROR_CANARY);
    expectOneFailure(records, {
      entryId: TEST_ENTRY.id,
      feedId: TEST_ENTRY.feedId,
      stage,
      errorCode,
    });
  });

  it('records a final response-unavailable failure without exposing the HTTP response', async () => {
    const { logger, records } = createContentLoggerSpy();
    const { service } = createContentService({
      logger,
      fetch: async () => {
        throw new FetchResponseUnavailableError(`HTTP 403 ${ARTICLE_URL}`);
      },
    });

    await expect(service.fetchAndClean(TEST_ENTRY.id)).resolves.toMatchObject({
      pipelineStatus: 'failed',
    });
    expectOneFailure(records, {
      entryId: TEST_ENTRY.id,
      feedId: TEST_ENTRY.feedId,
      stage: 'fetch',
      errorCode: CONTENT_PIPELINE_ERROR_CODES.responseUnavailable,
    });
    expect(JSON.stringify(records)).not.toContain(ARTICLE_URL);
  });

  it('records an extraction failure when every fetched candidate lacks an article', async () => {
    const { logger, records } = createContentLoggerSpy();
    const { service } = createContentService({
      logger,
      fetch: async (_url, _signal, validate) => {
        const candidate = createFetchResult();
        await validate?.(candidate);
        return candidate;
      },
      clean: () => {
        throw new ContentExtractionError();
      },
    });

    await expect(service.fetchAndClean(TEST_ENTRY.id)).resolves.toMatchObject({
      pipelineStatus: 'failed',
    });
    expectOneFailure(records, {
      entryId: TEST_ENTRY.id,
      feedId: TEST_ENTRY.feedId,
      stage: 'extract',
      errorCode: CONTENT_PIPELINE_ERROR_CODES.extractFailed,
    });
  });

  it('retains the final response-unavailable diagnosis in JSONL and diagnostic export', async () => {
    const directory = createLogDirectory();
    const structuredLogger = new StructuredLogger({
      directory,
      now: () => new Date('2026-07-21T12:00:00.000Z'),
      createSessionId: () => 'content-response-session',
    });
    const { service } = createContentService({
      logger: structuredLogger,
      fetch: async () => {
        throw new FetchResponseUnavailableError(`HTTP 403 ${ARTICLE_URL}`);
      },
    });

    await service.fetchAndClean(TEST_ENTRY.id);
    await structuredLogger.flush();

    const managedFile = readdirSync(directory).find((name) => name.endsWith('.jsonl'));
    if (!managedFile) throw new Error('Expected structured logger output file');
    const jsonlContents = readFileSync(path.join(directory, managedFile), 'utf8');
    expect(jsonlContents).toContain(CONTENT_PIPELINE_ERROR_CODES.responseUnavailable);
    expect(jsonlContents).not.toContain(ARTICLE_URL);

    const report = await new DiagnosticExportService({
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
      createTemporaryName: () => 'content-response-diagnostics',
    }).buildReport();
    expect(report.logs.records).toEqual([
      expect.objectContaining({
        event: CONTENT_LOG_EVENTS.pipelineFailed,
        context: expect.objectContaining({
          entryId: TEST_ENTRY.id,
          feedId: TEST_ENTRY.feedId,
          stage: 'fetch',
          errorCode: CONTENT_PIPELINE_ERROR_CODES.responseUnavailable,
        }),
      }),
    ]);
    expect(JSON.stringify(report)).not.toContain(ARTICLE_URL);
  });

  it('does not record a final failure when cached content makes a failed refresh displayable', async () => {
    const { logger, records } = createContentLoggerSpy();
    const cachedContent: CleanedContent = {
      entryId: TEST_ENTRY.id,
      sourceUrl: ARTICLE_URL,
      cleanedHtml: '<p>Previously readable article.</p>',
      markdown: 'Previously readable article.',
      pipelineStatus: 'success',
    };
    const { service } = createContentService({
      logger,
      cachedContent,
      fetch: async () => {
        throw new Error(PIPELINE_ERROR_CANARY);
      },
    });

    await expect(service.fetchAndClean(TEST_ENTRY.id)).resolves.toMatchObject({
      pipelineStatus: 'success',
      cleanedHtml: cachedContent.cleanedHtml,
    });
    expect(records).toEqual([
      expect.objectContaining({ event: CONTENT_LOG_EVENTS.pipelineCompleted }),
    ]);
  });

  it('uses the failed Feed fallback stage when it is the final reason content cannot be displayed', async () => {
    const { logger, records } = createContentLoggerSpy();
    const { service } = createContentService({
      logger,
      feedFallbackHtml: '<p>Publisher fallback</p>',
      fetch: async () => {
        throw new Error(PIPELINE_ERROR_CANARY);
      },
      cleanFeed: () => {
        throw new Error('FALLBACK_CLEAN_CANARY');
      },
    });

    await expect(service.fetchAndClean(TEST_ENTRY.id)).resolves.toMatchObject({
      pipelineStatus: 'failed',
    });
    expectOneFailure(records, {
      entryId: TEST_ENTRY.id,
      feedId: TEST_ENTRY.feedId,
      stage: 'clean',
      errorCode: CONTENT_PIPELINE_ERROR_CODES.cleanFailed,
    });
    expect(JSON.stringify(records)).not.toContain('FALLBACK_CLEAN_CANARY');
  });

  it('records a cache-read failure only when the read prevents a content result', async () => {
    const { logger, records } = createContentLoggerSpy();
    const cacheError = new Error('CACHE_READ_CANARY');
    const { service, contentStore } = createContentService({ logger });
    contentStore.findByEntry.mockImplementation(() => {
      throw cacheError;
    });

    await expect(service.getContent(TEST_ENTRY.id)).rejects.toBe(cacheError);
    expectOneFailure(records, {
      entryId: TEST_ENTRY.id,
      stage: 'cache',
      errorCode: CONTENT_PIPELINE_ERROR_CODES.cacheReadFailed,
    });
    expect(JSON.stringify(records)).not.toContain('CACHE_READ_CANARY');
  });

  it('records one cache-read failure when a fetch operation cannot inspect its fallback', async () => {
    const { logger, records } = createContentLoggerSpy();
    const cacheError = new Error('FETCH_CACHE_READ_CANARY');
    const { service, contentStore } = createContentService({ logger });
    contentStore.findByEntry.mockImplementation(() => {
      throw cacheError;
    });

    await expect(service.fetchAndClean(TEST_ENTRY.id)).rejects.toBe(cacheError);
    expectOneFailure(records, {
      entryId: TEST_ENTRY.id,
      feedId: TEST_ENTRY.feedId,
      stage: 'cache',
      errorCode: CONTENT_PIPELINE_ERROR_CODES.cacheReadFailed,
    });
    expect(JSON.stringify(records)).not.toContain('FETCH_CACHE_READ_CANARY');
  });

  it('does not record a business failure for a confirmed caller abort', async () => {
    const { logger, records } = createContentLoggerSpy();
    const controller = new AbortController();
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    controller.abort(abortError);
    const { service } = createContentService({
      logger,
      fetch: async () => {
        throw abortError;
      },
    });

    await expect(service.fetchAndClean(TEST_ENTRY.id, controller.signal)).resolves
      .toMatchObject({ pipelineStatus: 'failed' });
    expect(records).toEqual([]);
  });

  it('records a pipeline status update failure as a persist failure', async () => {
    const { logger, records } = createContentLoggerSpy();
    const { service } = createContentService({
      logger,
      updatePipelineStatus: () => {
        throw new Error(PIPELINE_ERROR_CANARY);
      },
    });

    const result = await service.fetchAndClean(TEST_ENTRY.id);

    expect(result.pipelineStatus).toBe('failed');
    expect(result.pipelineError).toBe(PIPELINE_ERROR_CANARY);
    expectOneFailure(records, {
      entryId: TEST_ENTRY.id,
      feedId: TEST_ENTRY.feedId,
      stage: 'persist',
      errorCode: CONTENT_PIPELINE_ERROR_CODES.persistFailed,
    });
  });

  it('rethrows a failed-status persistence error after recording only a persist failure', async () => {
    const { logger, records } = createContentLoggerSpy();
    const failedStatusPersistenceError = new Error('FAILED_STATUS_UPSERT_CANARY');
    const { service } = createContentService({
      logger,
      fetch: async () => {
        throw new Error(PIPELINE_ERROR_CANARY);
      },
      upsert: ({ pipelineStatus }) => {
        if (pipelineStatus === 'failed') {
          throw failedStatusPersistenceError;
        }
      },
    });

    await expect(service.fetchAndClean(TEST_ENTRY.id)).rejects.toBe(
      failedStatusPersistenceError,
    );
    expectOneFailure(records, {
      entryId: TEST_ENTRY.id,
      feedId: TEST_ENTRY.feedId,
      stage: 'persist',
      errorCode: CONTENT_PIPELINE_ERROR_CODES.persistFailed,
    });
  });

  it('drops runtime-invalid Content stage and error-code combinations before calling the logger', () => {
    const { logger, records } = createContentLoggerSpy();
    const safeContext = {
      entryId: TEST_ENTRY.id,
      feedId: TEST_ENTRY.feedId,
      durationMs: 0,
      success: false as const,
    };

    logContentPipelineFailure(logger, {
      ...safeContext,
      stage: 'unlisted-stage' as ContentLogContext['stage'],
      errorCode: CONTENT_PIPELINE_ERROR_CODES.fetchFailed,
    });
    logContentPipelineFailure(logger, {
      ...safeContext,
      stage: 'fetch',
      errorCode: CONTENT_PIPELINE_ERROR_CODES.persistFailed,
    });

    expect(records).toEqual([]);
  });

  it('validates Content IDs and duration before constructing a logger context', () => {
    const { logger, records } = createContentLoggerSpy();
    const validContext: ContentLogContext = {
      entryId: Number.MAX_SAFE_INTEGER,
      durationMs: 0,
      success: false,
      stage: 'fetch',
      errorCode: CONTENT_PIPELINE_ERROR_CODES.fetchFailed,
    };

    logContentPipelineFailure(logger, validContext);
    logContentPipelineFailure(logger, { ...validContext, entryId: 0 });
    logContentPipelineFailure(logger, { ...validContext, feedId: 0 });
    logContentPipelineFailure(logger, { ...validContext, durationMs: -1 });
    logContentPipelineFailure(logger, { ...validContext, durationMs: Number.NaN });

    expect(records).toEqual([
      expect.objectContaining({
        context: validContext,
      }),
    ]);
  });

  it('does not expose Content canaries to the injected logger or JSONL', async () => {
    const fakeLogger = createContentLoggerSpy();
    const directory = createLogDirectory();
    const structuredLogger = new StructuredLogger({
      directory,
      now: () => new Date('2026-07-21T12:00:00.000Z'),
      createSessionId: () => 'content-session-test',
    });
    const { service: fakeLoggerService } = createContentService({
      logger: fakeLogger.logger,
      convert: () => {
        throw new Error(PIPELINE_ERROR_CANARY);
      },
    });
    const { service: structuredLoggerService } = createContentService({
      logger: structuredLogger,
      convert: () => {
        throw new Error(PIPELINE_ERROR_CANARY);
      },
    });

    await fakeLoggerService.fetchAndClean(TEST_ENTRY.id);
    await structuredLoggerService.fetchAndClean(TEST_ENTRY.id);
    await structuredLogger.flush();

    const canaries = [
      RAW_HTML_CANARY,
      CLEANED_HTML_CANARY,
      MARKDOWN_CANARY,
      PIPELINE_ERROR_CANARY,
      HEADER_CANARY,
      DOCUMENT_BASE_URL_CANARY,
      ARTICLE_URL,
      ENTRY_TITLE,
      ENTRY_AUTHOR,
    ];
    const fakeContents = JSON.stringify(fakeLogger.records);
    const managedFile = readdirSync(directory).find((name) => name.endsWith('.jsonl'));
    if (!managedFile) {
      throw new Error('Expected structured logger output file');
    }
    const jsonlContents = readFileSync(path.join(directory, managedFile), 'utf8');

    for (const canary of canaries) {
      expect(fakeContents).not.toContain(canary);
      expect(jsonlContents).not.toContain(canary);
    }
    expect(jsonlContents).toContain(CONTENT_LOG_EVENTS.pipelineFailed);
    expect(jsonlContents).toContain(CONTENT_PIPELINE_ERROR_CODES.convertFailed);

    const report = await new DiagnosticExportService({
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
      createTemporaryName: () => 'content-diagnostics',
    }).buildReport();
    expect(report.logs.records).toEqual([
      expect.objectContaining({
        event: CONTENT_LOG_EVENTS.pipelineFailed,
        context: expect.objectContaining({
          entryId: TEST_ENTRY.id,
          feedId: TEST_ENTRY.feedId,
          stage: 'convert',
          errorCode: CONTENT_PIPELINE_ERROR_CODES.convertFailed,
          durationMs: expect.any(Number),
        }),
      }),
    ]);
    for (const canary of canaries) {
      expect(JSON.stringify(report)).not.toContain(canary);
    }
  });

  it('keeps the original failed result when the injected logger throws', async () => {
    const logger: ContentOperationLogger = {
      error: () => {
        throw new Error('LOGGER_FAILURE_CANARY_MUST_NOT_ESCAPE');
      },
    };
    const { service } = createContentService({
      logger,
      fetch: async () => {
        throw new Error(PIPELINE_ERROR_CANARY);
      },
    });

    await expect(service.fetchAndClean(TEST_ENTRY.id)).resolves.toMatchObject({
      entryId: TEST_ENTRY.id,
      pipelineStatus: 'failed',
      pipelineError: PIPELINE_ERROR_CANARY,
    });
  });
});
