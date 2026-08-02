import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticExportService } from '../../../src/main/diagnostics/DiagnosticExportService';
import {
  ENTRY_LIST_LOG_COMPONENT,
  ENTRY_LIST_LOG_ERROR_CODE,
  ENTRY_LIST_LOG_EVENT,
  type EntryListOperationLogger,
} from '../../../src/main/feed/services/EntryListLogging';
import { EntryStore } from '../../../src/main/feed/stores/EntryStore';
import { registerFeedIpcHandlers } from '../../../src/main/ipc/feed.handler';
import { StructuredLogger } from '../../../src/main/logging/StructuredLogger';
import type { FeedServices } from '../../../src/main/services';
import { FEED_IPC_CHANNELS, type EntryListRequest } from '../../../src/shared/contracts/feed.ipc';
import { FEED_ERROR_CODES } from '../../../src/shared/errors/feed.errors';

const registeredHandlers = vi.hoisted(() => new Map<string, unknown>());

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: unknown) => {
      registeredHandlers.set(channel, handler);
    },
  },
}));

type EntryListHandler = (
  event: IpcMainInvokeEvent,
  request: EntryListRequest,
) => Promise<unknown>;

const temporaryDirectories: string[] = [];
const SEARCH_CANARY = 'tag:ENTRY_LIST_PRIVATE_TAG';
const TAG_CANARY = 'ENTRY_LIST_PRIVATE_TAG';
const FEED_CANARY = 'ENTRY_LIST_PRIVATE_FEED';
const TITLE_CANARY = 'ENTRY_LIST_PRIVATE_TITLE';
const SQL_CANARY = 'SELECT ENTRY_LIST_SQL_CANARY FROM private_entry_table';
const PATH_CANARY = '/private/entry-list-canary/shale.db';
const RAW_ERROR_CANARY = 'ENTRY_LIST_RAW_SQLITE_ERROR_CANARY';

const sensitiveRequest: EntryListRequest = {
  search: SEARCH_CANARY,
  filters: [
    { field: 'tag', operator: '+', value: TAG_CANARY },
    { field: 'feed', operator: '+', value: FEED_CANARY },
    { field: 'title', operator: '+', value: TITLE_CANARY },
  ],
  isRead: false,
  isStarred: true,
  limit: 30,
};

function createDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'shale-entry-list-log-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createLogger(directory: string): StructuredLogger {
  return new StructuredLogger({
    directory,
    now: () => new Date('2026-08-02T12:00:00.000Z'),
    createSessionId: () => 'entry-list-log-test',
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

function createAuthorizedIpc(): {
  event: IpcMainInvokeEvent;
  mainWindow: BrowserWindow;
} {
  const webContents = { mainFrame: {} };
  const mainWindow = {
    isDestroyed: () => false,
    webContents,
  } as unknown as BrowserWindow;
  return {
    event: {
      sender: mainWindow.webContents,
      senderFrame: mainWindow.webContents.mainFrame,
    } as unknown as IpcMainInvokeEvent,
    mainWindow,
  };
}

function registerEntryList(
  entryStore: EntryStore,
  logger?: EntryListOperationLogger,
): { event: IpcMainInvokeEvent; handler: EntryListHandler } {
  const { event, mainWindow } = createAuthorizedIpc();
  registerFeedIpcHandlers(
    () => mainWindow,
    { entryStore } as unknown as FeedServices,
    logger,
  );
  const handler = registeredHandlers.get(FEED_IPC_CHANNELS.entryList) as EntryListHandler;
  if (!handler) throw new Error('Expected entry:list IPC handler');
  return { event, handler };
}

function createEntryStoreWithQueryResult(entries: unknown[]): EntryStore {
  return {
    query: vi.fn().mockReturnValue({ entries }),
  } as unknown as EntryStore;
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
    now: () => new Date('2026-08-02T12:00:01.000Z'),
    createTemporaryName: () => 'entry-list-diagnostics',
  });
}

beforeEach(() => {
  registeredHandlers.clear();
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('entry:list structured failure logging', () => {
  it('does not log successful or empty list results', async () => {
    const directory = createDirectory();
    const logger = createLogger(directory);
    const populated = registerEntryList(createEntryStoreWithQueryResult([{ id: 1 }]), logger);

    await expect(populated.handler(populated.event, { limit: 30 })).resolves.toMatchObject({
      ok: true,
      data: { entries: [{ id: 1 }] },
    });

    const empty = registerEntryList(createEntryStoreWithQueryResult([]), logger);
    await expect(empty.handler(empty.event, sensitiveRequest)).resolves.toEqual({
      ok: true,
      data: { entries: [] },
    });

    await logger.flush();
    expect(readRecords(directory)).toEqual([]);
  });

  it('returns a stable validation result without logging expected invalid input', async () => {
    const directory = createDirectory();
    const logger = createLogger(directory);
    const prepare = vi.fn();
    const entryStore = new EntryStore({ prepare } as unknown as Database.Database);
    const { event, handler } = registerEntryList(entryStore, logger);

    await expect(handler(event, { limit: 0 })).resolves.toEqual({
      ok: false,
      error: {
        code: FEED_ERROR_CODES.ENTRY_LIST_INVALID_REQUEST,
        message: '文章列表请求无效。',
        retryable: false,
      },
    });

    await logger.flush();
    expect(prepare).not.toHaveBeenCalled();
    expect(readRecords(directory)).toEqual([]);
  });

  it('writes exactly one safe database-read terminal and exports only its allowlisted fields', async () => {
    const directory = createDirectory();
    const structuredLogger = createLogger(directory);
    const noisyLogger: EntryListOperationLogger = {
      error: (event, component, context) => {
        structuredLogger.error(event, component, {
          ...context,
          feedId: 87654,
          operation: 'private-query-operation',
          search: SEARCH_CANARY,
          sql: SQL_CANARY,
          path: PATH_CANARY,
          rawError: RAW_ERROR_CANARY,
        } as never);
      },
    };
    const prepare = vi.fn(() => {
      throw new Error(`${RAW_ERROR_CANARY}; ${SQL_CANARY}; ${PATH_CANARY}`);
    });
    const entryStore = new EntryStore({ prepare } as unknown as Database.Database);
    const { event, handler } = registerEntryList(entryStore, noisyLogger);

    await expect(handler(event, sensitiveRequest)).resolves.toEqual({
      ok: false,
      error: {
        code: FEED_ERROR_CODES.ENTRY_LIST_FAILED,
        message: '无法读取本地文章。',
        retryable: true,
      },
    });

    await structuredLogger.flush();
    const records = readRecords(directory);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(records).toEqual([
      expect.objectContaining({
        level: 'error',
        event: ENTRY_LIST_LOG_EVENT,
        component: ENTRY_LIST_LOG_COMPONENT,
        context: {
          stage: 'read',
          errorCode: ENTRY_LIST_LOG_ERROR_CODE,
          durationMs: expect.any(Number),
          success: false,
        },
      }),
    ]);

    const report = await createDiagnosticExport(directory).buildReport();
    expect(report.logs.records).toEqual([
      expect.objectContaining({
        event: ENTRY_LIST_LOG_EVENT,
        component: ENTRY_LIST_LOG_COMPONENT,
        context: {
          stage: 'read',
          errorCode: ENTRY_LIST_LOG_ERROR_CODE,
          durationMs: expect.any(Number),
          success: false,
        },
      }),
    ]);

    const serialized = JSON.stringify({ records, report });
    for (const canary of [
      SEARCH_CANARY,
      TAG_CANARY,
      FEED_CANARY,
      TITLE_CANARY,
      SQL_CANARY,
      PATH_CANARY,
      RAW_ERROR_CANARY,
      'private-query-operation',
      '87654',
    ]) {
      expect(serialized).not.toContain(canary);
    }
  });
});
