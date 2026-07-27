import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UsageStatisticsService } from '../../../src/main/ai/services/UsageStatisticsService';
import {
  USAGE_STATISTICS_LOG_ERROR_CODES,
  USAGE_STATISTICS_LOG_EVENTS,
} from '../../../src/main/ai/services/UsageStatisticsLogging';
import type { UsageStore } from '../../../src/main/ai/stores/UsageStore';
import { DiagnosticExportService } from '../../../src/main/diagnostics/DiagnosticExportService';
import { registerUsageIpcHandlers } from '../../../src/main/ipc/usage.handler';
import { StructuredLogger } from '../../../src/main/logging/StructuredLogger';
import { USAGE_LEDGER_LOG_EVENTS } from '../../../src/main/ai/services/UsageRecorder';

const captured = vi.hoisted(() => ({
  handler: undefined as undefined | ((event: unknown, request: unknown) => unknown),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (_channel: string, handler: (event: unknown, request: unknown) => unknown) => {
      captured.handler = handler;
    },
  },
}));

const temporaryDirectories: string[] = [];
const START_AT_CANARY = '2042-02-03T04:05:06.000Z';
const END_AT_CANARY = '2042-02-04T04:05:06.000Z';
const TIME_ZONE_CANARY = 'Pacific/Chatham';
const MODEL_CANARY = 'USAGE_MODEL_CANARY_MUST_NOT_BE_LOGGED';
const PROVIDER_PROFILE_ID_CANARY = 76421;
const RAW_ERROR_CANARY = 'USAGE_RAW_ERROR_CANARY_MUST_NOT_BE_LOGGED';
const SQL_CANARY = 'SELECT USAGE_SQL_CANARY_MUST_NOT_BE_LOGGED';
const PATH_CANARY = '/private/usage-statistics-canary';

const query = {
  startAt: START_AT_CANARY,
  endAt: END_AT_CANARY,
  timeZone: TIME_ZONE_CANARY,
  taskType: 'translation',
  providerProfileId: PROVIDER_PROFILE_ID_CANARY,
  model: MODEL_CANARY,
};

function createDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'shale-usage-statistics-log-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createLogger(directory: string): StructuredLogger {
  return new StructuredLogger({
    directory,
    now: () => new Date('2026-07-27T12:00:00.000Z'),
    createSessionId: () => 'usage-statistics-log-test',
  });
}

function readRecords(directory: string): Array<Record<string, unknown>> {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) => readFileSync(path.join(directory, name), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>));
}

function createEvent(): unknown {
  const mainFrame = {};
  const webContents = { mainFrame };
  return { sender: webContents, senderFrame: mainFrame };
}

function createWindow(event: unknown) {
  const typedEvent = event as { sender: object; senderFrame: object };
  return {
    isDestroyed: () => false,
    webContents: typedEvent.sender,
  } as never;
}

function invoke(event: unknown, request: unknown): unknown {
  if (!captured.handler) throw new Error('Expected Usage Statistics IPC handler');
  return captured.handler(event, request);
}

function createDiagnosticExport(directory: string): DiagnosticExportService {
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
    createTemporaryName: () => 'usage-statistics-diagnostics',
  });
}

beforeEach(() => {
  captured.handler = undefined;
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Usage Statistics structured failure logging', () => {
  it('does not record successful queries or invalid requests', async () => {
    const directory = createDirectory();
    const logger = createLogger(directory);
    const service = new UsageStatisticsService({
      listForStatistics: () => [],
    } as unknown as UsageStore);
    const event = createEvent();
    registerUsageIpcHandlers(() => createWindow(event), service, logger);

    expect(invoke(event, query)).toMatchObject({ ok: true });
    expect(invoke(event, { ...query, endAt: START_AT_CANARY })).toMatchObject({
      ok: false,
      error: { code: 'USAGE_INVALID_REQUEST' },
    });

    await logger.flush();
    expect(readRecords(directory)).toEqual([]);
  });

  it('writes one safe terminal read failure and retains it in the diagnostic export', async () => {
    const directory = createDirectory();
    const logger = createLogger(directory);
    const service = new UsageStatisticsService({
      listForStatistics: () => {
        throw new Error(`${RAW_ERROR_CANARY}; ${SQL_CANARY}; ${PATH_CANARY}`);
      },
    } as unknown as UsageStore);
    const event = createEvent();
    registerUsageIpcHandlers(() => createWindow(event), service, logger);

    expect(invoke(event, query)).toEqual({
      ok: false,
      error: {
        code: 'USAGE_QUERY_FAILED',
        message: 'Unable to read usage statistics.',
        retryable: true,
      },
    });

    await logger.flush();
    const records = readRecords(directory);
    expect(records).toEqual([
      expect.objectContaining({
        level: 'error',
        event: USAGE_STATISTICS_LOG_EVENTS.failed,
        component: 'usage.statistics',
        context: {
          stage: 'read',
          errorCode: USAGE_STATISTICS_LOG_ERROR_CODES.readFailed,
          durationMs: expect.any(Number),
          success: false,
        },
      }),
    ]);
    expect(records.some((record) => record.event === USAGE_LEDGER_LOG_EVENTS.persistenceFailed))
      .toBe(false);

    const report = await createDiagnosticExport(directory).buildReport();
    expect(report.logs.records).toEqual([
      expect.objectContaining({
        event: USAGE_STATISTICS_LOG_EVENTS.failed,
        component: 'usage.statistics',
        context: {
          stage: 'read',
          errorCode: USAGE_STATISTICS_LOG_ERROR_CODES.readFailed,
          durationMs: expect.any(Number),
          success: false,
        },
      }),
    ]);

    const serialized = JSON.stringify({ records, report });
    for (const canary of [
      START_AT_CANARY,
      END_AT_CANARY,
      TIME_ZONE_CANARY,
      MODEL_CANARY,
      String(PROVIDER_PROFILE_ID_CANARY),
      RAW_ERROR_CANARY,
      SQL_CANARY,
      PATH_CANARY,
    ]) {
      expect(serialized).not.toContain(canary);
    }
  });
});
