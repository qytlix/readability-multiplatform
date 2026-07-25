import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { IPCResult } from '../../shared/contracts/feed.ipc';
import { USAGE_IPC_CHANNELS } from '../../shared/contracts/usage.ipc';
import {
  USAGE_STATISTICS_TASK_TYPES,
  type UsageStatistics,
  type UsageStatisticsQuery,
} from '../../shared/contracts/usage.types';
import type { UsageStatisticsService } from '../ai/services/UsageStatisticsService';

type GetMainWindow = () => BrowserWindow | null;

export function registerUsageIpcHandlers(
  getMainWindow: GetMainWindow,
  usageStatisticsService: UsageStatisticsService,
): void {
  ipcMain.handle(
    USAGE_IPC_CHANNELS.statisticsGet,
    (event: IpcMainInvokeEvent, request: unknown): IPCResult<UsageStatistics> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      const query = parseUsageStatisticsQuery(request);
      if (!query) return invalidRequest();
      try {
        return { ok: true, data: usageStatisticsService.getStatistics(query) };
      } catch {
        return queryFailure();
      }
    },
  );
}

function isAuthorizedSender(
  event: IpcMainInvokeEvent,
  getMainWindow: GetMainWindow,
): boolean {
  const mainWindow = getMainWindow();
  return Boolean(
    mainWindow
    && !mainWindow.isDestroyed()
    && event.sender === mainWindow.webContents
    && event.senderFrame === mainWindow.webContents.mainFrame,
  );
}

function parseUsageStatisticsQuery(value: unknown): UsageStatisticsQuery | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const request = value as Record<string, unknown>;
  const startAt = normalizeTimestamp(request.startAt);
  const endAt = normalizeTimestamp(request.endAt);
  if (!startAt || !endAt || startAt >= endAt) return undefined;
  if (typeof request.timeZone !== 'string' || !isValidTimeZone(request.timeZone)) return undefined;
  if (request.taskType !== undefined && !USAGE_STATISTICS_TASK_TYPES.includes(
    request.taskType as (typeof USAGE_STATISTICS_TASK_TYPES)[number],
  )) return undefined;
  if (request.providerProfileId !== undefined && (
    !Number.isInteger(request.providerProfileId) || (request.providerProfileId as number) <= 0
  )) return undefined;
  if (request.model !== undefined && (
    typeof request.model !== 'string' || !request.model.trim() || request.model.length > 256
  )) return undefined;

  return {
    startAt,
    endAt,
    timeZone: request.timeZone,
    ...(request.taskType === undefined ? {} : { taskType: request.taskType as UsageStatisticsQuery['taskType'] }),
    ...(request.providerProfileId === undefined
      ? {}
      : { providerProfileId: request.providerProfileId as number }),
    ...(request.model === undefined ? {} : { model: request.model }),
  };
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function isValidTimeZone(value: string): boolean {
  if (!value || value.length > 128) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function invalidRequest(): IPCResult<never> {
  return {
    ok: false,
    error: {
      code: 'USAGE_INVALID_REQUEST',
      message: 'The usage statistics query is invalid.',
      retryable: false,
    },
  };
}

function queryFailure(): IPCResult<never> {
  return {
    ok: false,
    error: {
      code: 'USAGE_QUERY_FAILED',
      message: 'Unable to read usage statistics.',
      retryable: true,
    },
  };
}

function unauthorized(): IPCResult<never> {
  return {
    ok: false,
    error: {
      code: 'UNAUTHORIZED',
      message: 'Unauthorized IPC sender.',
      retryable: false,
    },
  };
}
