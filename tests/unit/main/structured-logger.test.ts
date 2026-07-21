import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STRUCTURED_LOG_SCHEMA_VERSION,
  StructuredLogger,
  type LogLineWriter,
  type StructuredLogContext,
} from '../../../src/main/logging/StructuredLogger';
import { MAIN_LIFECYCLE_EVENTS } from '../../../src/main/logging/MainLifecycleEvents';
import {
  CONTENT_LOG_COMPONENTS,
  CONTENT_LOG_EVENTS,
  CONTENT_PIPELINE_ERROR_CODES,
} from '../../../src/main/feed/services/ContentLogging';
import {
  logOPMLExportCompleted,
  logOPMLExportFailed,
  logOPMLExportTempCleanupFailed,
  logOPMLImportCompleted,
  logOPMLImportFailed,
  OPML_LOG_ERROR_CODES,
  OPML_LOG_EVENTS,
} from '../../../src/main/feed/services/OPMLLogging';
import {
  logProviderConfigCompleted,
  logProviderConfigFailed,
  logProviderConnectionCompleted,
  logProviderConnectionFailed,
  logProviderSecretCleanupFailed,
  PROVIDER_LOG_ERROR_CODES,
  PROVIDER_LOG_EVENTS,
} from '../../../src/main/ai/services/ProviderLogging';
import {
  logSummaryRecoveryCompleted,
  logSummaryRunCompleted,
  logSummaryRunFailed,
  logSummaryRunInterrupted,
  logSummaryRunStarted,
  SUMMARY_LOG_ERROR_CODES,
  SUMMARY_LOG_EVENTS,
} from '../../../src/main/ai/services/SummaryLogging';

const filesystemControl = vi.hoisted(() => ({
  readdir: 0,
  failNextStat: false,
  failNextUnlink: false,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    readdir: (...arguments_: Parameters<typeof original.readdir>) => {
      filesystemControl.readdir += 1;
      return original.readdir(...arguments_);
    },
    stat: (...arguments_: Parameters<typeof original.stat>) => {
      if (filesystemControl.failNextStat) {
        filesystemControl.failNextStat = false;
        throw Object.assign(new Error('test stat failure'), { code: 'EIO' });
      }
      return original.stat(...arguments_);
    },
    unlink: (...arguments_: Parameters<typeof original.unlink>) => {
      if (filesystemControl.failNextUnlink) {
        filesystemControl.failNextUnlink = false;
        throw Object.assign(new Error('test cleanup failure'), { code: 'EACCES' });
      }
      return original.unlink(...arguments_);
    },
  };
});

const temporaryDirectories: string[] = [];
const fixedNow = new Date('2026-07-20T12:00:00.000Z');

afterEach(() => {
  filesystemControl.failNextStat = false;
  filesystemControl.failNextUnlink = false;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createLogDirectory(prefix = 'shale-structured-log-test-'): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function createLogger(
  directory: string,
  options: Omit<
    ConstructorParameters<typeof StructuredLogger>[0],
    'directory' | 'now' | 'createSessionId'
  > = {},
): StructuredLogger {
  return new StructuredLogger({
    directory,
    now: () => fixedNow,
    createSessionId: () => 'session-test-1',
    ...options,
  });
}

function getManagedFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => /^structured-\d{4}-\d{2}-\d{2}(?:-[1-9]\d*)?\.jsonl$/.test(name))
    .sort();
}

function readRecords(directory: string): Array<Record<string, unknown>> {
  return getManagedFiles(directory).flatMap((name) =>
    readFileSync(path.join(directory, name), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  );
}

describe('StructuredLogger', () => {
  it('writes every legal Summary event with only its safe fields', async () => {
    const directory = createLogDirectory();
    const logger = createLogger(directory);

    logSummaryRunStarted(logger, { taskRunId: 12 });
    logSummaryRunCompleted(logger, {
      taskRunId: 12,
      durationMs: 1,
      success: true,
    });
    logSummaryRunFailed(logger, {
      taskRunId: 13,
      durationMs: 2,
      success: false,
      stage: 'stream',
      errorCode: SUMMARY_LOG_ERROR_CODES.providerTimeout,
    });
    logSummaryRunInterrupted(logger, {
      taskRunId: 14,
      durationMs: 3,
      success: false,
      stage: 'interrupt',
      errorCode: SUMMARY_LOG_ERROR_CODES.interrupted,
    });
    logSummaryRecoveryCompleted(logger, { durationMs: 4, count: 2 });
    await logger.flush();

    const records = readRecords(directory);
    expect(records.map((record) => record.event)).toEqual([
      SUMMARY_LOG_EVENTS.runStarted,
      SUMMARY_LOG_EVENTS.runCompleted,
      SUMMARY_LOG_EVENTS.runFailed,
      SUMMARY_LOG_EVENTS.runInterrupted,
      SUMMARY_LOG_EVENTS.recoveryCompleted,
    ]);
    expect(records[0].context).toEqual({ taskRunId: 12 });
    expect(records[1].context).toEqual({ taskRunId: 12, durationMs: 1, success: true });
    expect(records[2].context).toEqual({
      taskRunId: 13,
      durationMs: 2,
      success: false,
      stage: 'stream',
      errorCode: SUMMARY_LOG_ERROR_CODES.providerTimeout,
    });
    expect(records[3].context).toEqual({
      taskRunId: 14,
      durationMs: 3,
      success: false,
      stage: 'interrupt',
      errorCode: SUMMARY_LOG_ERROR_CODES.interrupted,
    });
    expect(records[4].context).toEqual({ durationMs: 4, count: 2 });
  });

  it('writes every legal Provider event with only its safe fields', async () => {
    const directory = createLogDirectory();
    const logger = createLogger(directory);

    logProviderConfigCompleted(logger, {
      providerId: 8,
      durationMs: 1,
      success: true,
    });
    logProviderConfigFailed(logger, {
      durationMs: 2,
      success: false,
      stage: 'key',
      errorCode: PROVIDER_LOG_ERROR_CODES.keyStorageUnavailable,
    });
    logProviderConnectionCompleted(logger, {
      providerId: 8,
      durationMs: 3,
      success: true,
    });
    logProviderConnectionFailed(logger, {
      providerId: 8,
      durationMs: 4,
      success: false,
      stage: 'request',
      errorCode: PROVIDER_LOG_ERROR_CODES.providerAuth,
    });
    logProviderSecretCleanupFailed(logger, {
      providerId: 8,
      durationMs: 5,
      stage: 'cleanup',
      errorCode: PROVIDER_LOG_ERROR_CODES.secretCleanupFailed,
    });
    await logger.flush();

    const records = readRecords(directory);
    expect(records.map((record) => record.event)).toEqual([
      PROVIDER_LOG_EVENTS.configCompleted,
      PROVIDER_LOG_EVENTS.configFailed,
      PROVIDER_LOG_EVENTS.connectionCompleted,
      PROVIDER_LOG_EVENTS.connectionFailed,
      PROVIDER_LOG_EVENTS.secretCleanupFailed,
    ]);
    expect(records[0].context).toEqual({ providerId: 8, durationMs: 1, success: true });
    expect(records[1].context).toEqual({
      durationMs: 2,
      success: false,
      stage: 'key',
      errorCode: PROVIDER_LOG_ERROR_CODES.keyStorageUnavailable,
    });
    expect(records[2].context).toEqual({ providerId: 8, durationMs: 3, success: true });
    expect(records[3].context).toEqual({
      providerId: 8,
      durationMs: 4,
      success: false,
      stage: 'request',
      errorCode: PROVIDER_LOG_ERROR_CODES.providerAuth,
    });
    expect(records[4].context).toEqual({
      providerId: 8,
      durationMs: 5,
      stage: 'cleanup',
      errorCode: PROVIDER_LOG_ERROR_CODES.secretCleanupFailed,
    });
  });

  it('writes every legal OPML event with only its safe fields', async () => {
    const directory = createLogDirectory();
    const logger = createLogger(directory);

    logOPMLImportCompleted(logger, {
      durationMs: 1,
      count: 4,
      successCount: 2,
      failureCount: 1,
    });
    logOPMLImportFailed(logger, {
      durationMs: 2,
      stage: 'parse',
      errorCode: OPML_LOG_ERROR_CODES.importInvalid,
    });
    logOPMLExportCompleted(logger, { durationMs: 3, count: 4 });
    logOPMLExportFailed(logger, {
      durationMs: 4,
      stage: 'rename',
      errorCode: OPML_LOG_ERROR_CODES.exportRenameFailed,
      count: 4,
    });
    logOPMLExportTempCleanupFailed(logger, {
      durationMs: 5,
      stage: 'cleanup',
      errorCode: OPML_LOG_ERROR_CODES.exportTempCleanupFailed,
    });
    await logger.flush();

    const records = readRecords(directory);
    expect(records).toHaveLength(5);
    expect(records.map((record) => record.event)).toEqual([
      OPML_LOG_EVENTS.importCompleted,
      OPML_LOG_EVENTS.importFailed,
      OPML_LOG_EVENTS.exportCompleted,
      OPML_LOG_EVENTS.exportFailed,
      OPML_LOG_EVENTS.exportTempCleanupFailed,
    ]);
    expect(records[0].context).toEqual({
      durationMs: 1,
      count: 4,
      successCount: 2,
      failureCount: 1,
    });
    expect(records[1].context).toEqual({
      durationMs: 2,
      stage: 'parse',
      errorCode: OPML_LOG_ERROR_CODES.importInvalid,
    });
    expect(records[2].context).toEqual({ durationMs: 3, count: 4 });
    expect(records[3].context).toEqual({
      durationMs: 4,
      stage: 'rename',
      errorCode: OPML_LOG_ERROR_CODES.exportRenameFailed,
      count: 4,
    });
    expect(records[4].context).toEqual({
      durationMs: 5,
      stage: 'cleanup',
      errorCode: OPML_LOG_ERROR_CODES.exportTempCleanupFailed,
    });
  });

  it('writes every Main lifecycle event as independently parseable JSONL', async () => {
    const directory = createLogDirectory();
    const logger = createLogger(directory);
    const lifecycleRecords = [
      [MAIN_LIFECYCLE_EVENTS.starting, 'app.lifecycle'],
      [MAIN_LIFECYCLE_EVENTS.databaseInitializeStarted, 'database.lifecycle'],
      [MAIN_LIFECYCLE_EVENTS.databaseInitializeCompleted, 'database.lifecycle'],
      [MAIN_LIFECYCLE_EVENTS.databaseInitializeFailed, 'database.lifecycle'],
      [MAIN_LIFECYCLE_EVENTS.initializationFailed, 'app.lifecycle'],
      [MAIN_LIFECYCLE_EVENTS.ready, 'app.lifecycle'],
      [MAIN_LIFECYCLE_EVENTS.shutdownRequested, 'app.lifecycle'],
    ] as const;

    for (const [event, component] of lifecycleRecords) {
      logger.info(event, component);
    }
    await logger.flush();

    expect(readRecords(directory).map((record) => record.event)).toEqual(
      lifecycleRecords.map(([event]) => event),
    );
  });

  it('writes independently parseable JSONL records with the fixed fields', async () => {
    const directory = createLogDirectory();
    const logger = createLogger(directory);

    logger.info('feed.sync.completed', 'feed.sync', {
      feedId: 42,
      count: 3,
      success: true,
      phase: 'sync',
      arch: 'arm64',
    });
    await logger.flush();

    const [record] = readRecords(directory);
    expect(record).toEqual({
      schemaVersion: STRUCTURED_LOG_SCHEMA_VERSION,
      timestamp: fixedNow.toISOString(),
      level: 'info',
      event: 'feed.sync.completed',
      component: 'feed.sync',
      sessionId: 'session-test-1',
      context: {
        feedId: 42,
        count: 3,
        success: true,
        phase: 'sync',
        arch: 'arm64',
      },
    });
  });

  it('retains the bounded numeric fields required by Feed sync summaries', async () => {
    const directory = createLogDirectory();
    const logger = createLogger(directory);

    logger.info('feed.sync.run.completed', 'feed.sync', {
      trigger: 'manual',
      durationMs: 42,
      successCount: 3,
      failureCount: 1,
      newCount: 7,
    });
    await logger.flush();

    expect(readRecords(directory)[0].context).toEqual({
      trigger: 'manual',
      durationMs: 42,
      successCount: 3,
      failureCount: 1,
      newCount: 7,
    });
  });

  it('serializes concurrent calls in call order without interleaving JSONL rows', async () => {
    const directory = createLogDirectory();
    const logger = createLogger(directory);

    await Promise.all(
      Array.from({ length: 24 }, (_, count) => Promise.resolve().then(() => {
        logger.info('test.concurrent', 'test.logger', { count });
      })),
    );
    await logger.flush();

    const records = readRecords(directory);
    expect(records).toHaveLength(24);
    expect(records.map((record) => (record.context as { count: number }).count))
      .toEqual(Array.from({ length: 24 }, (_, count) => count));
  });

  it('filters records below the configured minimum level', async () => {
    const directory = createLogDirectory();
    const logger = createLogger(directory, { minimumLevel: 'warn' });

    logger.debug('test.debug', 'test.logger');
    logger.info('test.info', 'test.logger');
    logger.warn('test.warn', 'test.logger');
    logger.error('test.error', 'test.logger');
    await logger.flush();

    expect(readRecords(directory).map((record) => record.level)).toEqual(['warn', 'error']);
  });

  it('drops unknown, nested, sensitive, and free-text context values', async () => {
    const directory = createLogDirectory();
    const logger = createLogger(directory);
    const canary = 'CANARY_SECRET_VALUE_MUST_NOT_APPEAR';
    const unsafeContext = {
      feedId: 9,
      errorCode: 'FEED_FETCH_FAILED',
      stage: canary,
      apiKey: canary,
      authorization: canary,
      filePath: '/Users/example/private.opml',
      request: { token: canary },
      response: [canary],
      nested: { value: canary },
      phase: 'external',
    } as unknown as StructuredLogContext;

    logger.error('feed.sync.failed', 'feed.sync', unsafeContext);
    await logger.flush();

    const contents = readFileSync(
      path.join(directory, getManagedFiles(directory)[0]),
      'utf8',
    );
    expect(contents).not.toContain(canary);
    expect(contents).not.toContain('apiKey');
    expect(contents).not.toContain('authorization');
    expect(contents).not.toContain('filePath');
    expect(contents).toContain('FEED_FETCH_FAILED');
    expect(readRecords(directory)[0].context).toEqual({
      feedId: 9,
      errorCode: 'FEED_FETCH_FAILED',
    });
  });

  it('accepts the fixed Content failure context while dropping unsafe values', async () => {
    const directory = createLogDirectory();
    const logger = createLogger(directory);
    const canary = 'CONTENT_FREE_TEXT_CANARY_MUST_NOT_APPEAR';
    const safeContext = {
      entryId: 41,
      feedId: 12,
      durationMs: 5,
      success: false,
      stage: 'fetch',
      errorCode: CONTENT_PIPELINE_ERROR_CODES.fetchFailed,
      html: canary,
      markdown: canary,
      sourceUrl: `https://${canary}.example.test`,
      pipelineError: canary,
      response: { body: canary },
    } as unknown as StructuredLogContext;
    const invalidStageContext = {
      entryId: 42,
      durationMs: 6,
      success: false,
      stage: 'free text stage',
      errorCode: CONTENT_PIPELINE_ERROR_CODES.fetchFailed,
      message: canary,
    } as unknown as StructuredLogContext;

    logger.error(
      CONTENT_LOG_EVENTS.pipelineFailed,
      CONTENT_LOG_COMPONENTS.pipeline,
      safeContext,
    );
    logger.error(
      CONTENT_LOG_EVENTS.pipelineFailed,
      CONTENT_LOG_COMPONENTS.pipeline,
      invalidStageContext,
    );
    await logger.flush();

    const contents = readFileSync(
      path.join(directory, getManagedFiles(directory)[0]),
      'utf8',
    );
    const records = readRecords(directory);
    expect(contents).not.toContain(canary);
    expect(records[0]).toMatchObject({
      event: CONTENT_LOG_EVENTS.pipelineFailed,
      component: CONTENT_LOG_COMPONENTS.pipeline,
      context: {
        entryId: 41,
        feedId: 12,
        durationMs: 5,
        success: false,
        stage: 'fetch',
        errorCode: CONTENT_PIPELINE_ERROR_CODES.fetchFailed,
      },
    });
    expect(records[1].context).toEqual({
      entryId: 42,
      durationMs: 6,
      success: false,
      errorCode: CONTENT_PIPELINE_ERROR_CODES.fetchFailed,
    });
  });

  it('rotates to an incrementing same-day shard before exceeding the file budget', async () => {
    const directory = createLogDirectory();
    const logger = createLogger(directory, {
      retention: { maxFileBytes: 300, maxTotalBytes: 2_000 },
    });

    logger.info('test.rotate', 'test.logger', { stage: 'x'.repeat(80) });
    logger.info('test.rotate', 'test.logger', { stage: 'y'.repeat(80) });
    await logger.flush();

    expect(getManagedFiles(directory)).toEqual([
      'structured-2026-07-20-1.jsonl',
      'structured-2026-07-20.jsonl',
    ]);
    expect(readRecords(directory)).toHaveLength(2);
  });

  it('scans for retention at rotation, but not during ordinary active-file appends', async () => {
    const directory = createLogDirectory();
    const logger = createLogger(directory, {
      retention: { maxFileBytes: 300, maxTotalBytes: 2_000 },
    });
    await logger.flush();

    const callsAfterInitialization = filesystemControl.readdir;
    logger.info('test.scan.first', 'test.logger', { stage: 'x'.repeat(80) });
    await logger.flush();
    expect(filesystemControl.readdir).toBe(callsAfterInitialization);

    logger.info('test.scan.rotated', 'test.logger', { stage: 'y'.repeat(80) });
    await logger.flush();
    expect(filesystemControl.readdir).toBeGreaterThan(callsAfterInitialization);
  });

  it('continues from a new shard after restart when the highest shard is full', async () => {
    const directory = createLogDirectory();
    const baseFile = path.join(directory, 'structured-2026-07-20.jsonl');
    const highestShard = path.join(directory, 'structured-2026-07-20-1.jsonl');
    const invalidZeroShard = path.join(directory, 'structured-2026-07-20-0.jsonl');
    const baseContents = `${JSON.stringify({ padding: 'a'.repeat(280) })}\n`;
    const highestShardContents = `${JSON.stringify({ padding: 'b'.repeat(280) })}\n`;
    writeFileSync(baseFile, baseContents);
    writeFileSync(highestShard, highestShardContents);
    writeFileSync(invalidZeroShard, 'must remain unmanaged');

    const logger = createLogger(directory, {
      retention: { maxFileBytes: 300, maxTotalBytes: 2_000 },
    });
    logger.info('test.restart', 'test.logger', { count: 1 });
    await logger.flush();

    const newShard = path.join(directory, 'structured-2026-07-20-2.jsonl');
    expect(readFileSync(baseFile, 'utf8')).toBe(baseContents);
    expect(readFileSync(highestShard, 'utf8')).toBe(highestShardContents);
    expect(readFileSync(invalidZeroShard, 'utf8')).toBe('must remain unmanaged');
    expect(readRecords(directory)).toContainEqual(expect.objectContaining({
      event: 'test.restart',
      context: { count: 1 },
    }));
    expect(statSync(newShard).size).toBeGreaterThan(0);
  });

  it('cleans expired files and oldest managed files over the total budget only', async () => {
    const directory = createLogDirectory();
    const expired = path.join(directory, 'structured-2026-07-10.jsonl');
    const oldest = path.join(directory, 'structured-2026-07-18.jsonl');
    const retained = path.join(directory, 'structured-2026-07-19.jsonl');
    const active = path.join(directory, 'structured-2026-07-20.jsonl');
    const unrelated = path.join(directory, 'notes-do-not-delete.txt');
    const malformedManagedName = path.join(directory, 'structured-2026-99-99.jsonl');
    writeFileSync(expired, 'expired\n'.repeat(40));
    writeFileSync(oldest, 'oldest\n'.repeat(40));
    writeFileSync(retained, 'retained\n'.repeat(40));
    writeFileSync(active, 'active\n'.repeat(10));
    writeFileSync(unrelated, 'keep me');
    writeFileSync(malformedManagedName, 'also keep me');

    const logger = createLogger(directory, {
      retention: { maxAgeDays: 7, maxFileBytes: 1_000, maxTotalBytes: 500 },
    });
    await logger.flush();

    expect(getManagedFiles(directory)).not.toContain('structured-2026-07-10.jsonl');
    expect(getManagedFiles(directory)).not.toContain('structured-2026-07-18.jsonl');
    expect(getManagedFiles(directory)).toContain('structured-2026-07-19.jsonl');
    expect(getManagedFiles(directory)).toContain('structured-2026-07-20.jsonl');
    expect(readFileSync(unrelated, 'utf8')).toBe('keep me');
    expect(readFileSync(malformedManagedName, 'utf8')).toBe('also keep me');
  });

  it('writes to directories containing spaces and Unicode characters', async () => {
    const directory = createLogDirectory('shale 日志 space-');
    const logger = createLogger(directory);

    logger.info('test.path', 'test.logger', { count: 1 });
    await logger.flush();

    const filePath = path.join(directory, 'structured-2026-07-20.jsonl');
    expect(statSync(filePath).size).toBeGreaterThan(0);
  });

  it('continues after an append failure and reports one safe stderr fallback notice', async () => {
    const directory = createLogDirectory();
    const notices: string[] = [];
    const canary = 'CANARY_APPEND_FAILURE_MESSAGE';
    let attempts = 0;
    const writeLine: LogLineWriter = vi.fn(async (filePath, line) => {
      attempts += 1;
      if (attempts <= 2) {
        throw Object.assign(new Error(canary), { code: 'EACCES' });
      }
      appendFileSync(filePath, line, 'utf8');
    });
    const logger = createLogger(directory, {
      writeLine,
      writeFailureNotice: (notice) => notices.push(notice),
    });

    expect(() => logger.error('test.write.failed', 'test.logger', { count: 1 })).not.toThrow();
    logger.error('test.write.failed.again', 'test.logger', { count: 2 });
    logger.error('test.write.recovered', 'test.logger', { count: 3 });
    await expect(logger.flush()).resolves.toBeUndefined();
    expect(writeLine).toHaveBeenCalledTimes(3);
    expect(readRecords(directory)).toContainEqual(expect.objectContaining({
      event: 'test.write.recovered',
      context: { count: 3 },
    }));
    expect(notices).toEqual(['Structured logger failure [EACCES]\n']);
    expect(notices.join('')).not.toContain(canary);
  });

  it('recovers after initialization mkdir failure without rejecting later log work', async () => {
    const parentDirectory = createLogDirectory();
    const directory = path.join(parentDirectory, 'blocked-log-directory');
    const notices: string[] = [];
    writeFileSync(directory, 'not a directory');

    const logger = createLogger(directory, {
      writeFailureNotice: (notice) => notices.push(notice),
    });
    await expect(logger.flush()).resolves.toBeUndefined();

    rmSync(directory);
    mkdirSync(directory);
    logger.info('test.mkdir.recovered', 'test.logger', { success: true });
    await expect(logger.flush()).resolves.toBeUndefined();

    expect(readRecords(directory)).toContainEqual(expect.objectContaining({
      event: 'test.mkdir.recovered',
      context: { success: true },
    }));
    expect(notices).toEqual(['Structured logger failure [EEXIST]\n']);
  });

  it('keeps later writes queueable after stat inspection and cleanup failures', async () => {
    const statFailureDirectory = createLogDirectory();
    const statFailureNotices: string[] = [];
    writeFileSync(
      path.join(statFailureDirectory, 'structured-2026-07-20.jsonl'),
      '{"previous":true}\n',
    );
    filesystemControl.failNextStat = true;
    const statFailureLogger = createLogger(statFailureDirectory, {
      writeFailureNotice: (notice) => statFailureNotices.push(notice),
    });
    await expect(statFailureLogger.flush()).resolves.toBeUndefined();
    statFailureLogger.info('test.stat.recovered', 'test.logger', { count: 1 });
    await expect(statFailureLogger.flush()).resolves.toBeUndefined();

    expect(readRecords(statFailureDirectory)).toContainEqual(expect.objectContaining({
      event: 'test.stat.recovered',
      context: { count: 1 },
    }));
    expect(statFailureNotices).toEqual(['Structured logger failure [EIO]\n']);

    const cleanupFailureDirectory = createLogDirectory();
    const cleanupFailureNotices: string[] = [];
    const expiredFile = path.join(cleanupFailureDirectory, 'structured-2026-07-10.jsonl');
    writeFileSync(expiredFile, 'expired');
    filesystemControl.failNextUnlink = true;
    const cleanupFailureLogger = createLogger(cleanupFailureDirectory, {
      writeFailureNotice: (notice) => cleanupFailureNotices.push(notice),
    });
    await expect(cleanupFailureLogger.flush()).resolves.toBeUndefined();
    cleanupFailureLogger.info('test.cleanup.recovered', 'test.logger', { count: 2 });
    await expect(cleanupFailureLogger.flush()).resolves.toBeUndefined();

    const currentFile = path.join(cleanupFailureDirectory, 'structured-2026-07-20.jsonl');
    expect(readFileSync(expiredFile, 'utf8')).toBe('expired');
    expect(readFileSync(currentFile, 'utf8')).toContain('test.cleanup.recovered');
    expect(cleanupFailureNotices).toEqual(['Structured logger failure [EACCES]\n']);
  });

  it('drops malformed event and component identifiers without writing their values', async () => {
    const directory = createLogDirectory();
    const logger = createLogger(directory);
    const invalidEvent = 'test_event_not_dot_separated';
    const invalidComponent = 'Test.Logger';
    const tooLongEvent = `test.${'a'.repeat(92)}`;

    logger.info('test.valid', 'test.logger', { count: 1 });
    logger.info(invalidEvent, 'test.logger');
    logger.info('test.invalid.component', invalidComponent);
    logger.info(tooLongEvent, 'test.logger');
    expect(() => logger.info(123 as unknown as string, 'test.logger')).not.toThrow();
    await logger.flush();

    const contents = readFileSync(
      path.join(directory, 'structured-2026-07-20.jsonl'),
      'utf8',
    );
    expect(readRecords(directory)).toHaveLength(1);
    expect(contents).not.toContain(invalidEvent);
    expect(contents).not.toContain(invalidComponent);
    expect(contents).not.toContain(tooLongEvent);
  });
});
