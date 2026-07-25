import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { USAGE_IPC_CHANNELS } from '../../../src/shared/contracts/usage.ipc';
import type { UsageStatistics } from '../../../src/shared/contracts/usage.types';

const captured = vi.hoisted(() => ({
  channel: '',
  handler: undefined as undefined | ((event: unknown, request: unknown) => unknown),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, request: unknown) => unknown) => {
      captured.channel = channel;
      captured.handler = handler;
    },
  },
}));

import { registerUsageIpcHandlers } from '../../../src/main/ipc/usage.handler';
import type { UsageStatisticsService } from '../../../src/main/ai/services/UsageStatisticsService';

const statistics: UsageStatistics = {
  query: {
    startAt: '2026-01-01T00:00:00.000Z',
    endAt: '2026-01-02T00:00:00.000Z',
    timeZone: 'UTC',
  },
  totals: {
    requestCount: 0,
    requestStatus: { running: 0, succeeded: 0, failed: 0, interrupted: 0 },
    tokenTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    tokenCoverage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reportedRequests: 0,
      partialRequests: 0,
      missingRequests: 0,
    },
    attemptCoverage: {
      knownAttemptCount: 0,
      unassignedRequestCount: 0,
    },
  },
  byDay: [],
  byTaskType: [],
  byModel: [],
};

function createAuthorizedWindow(): { mainWindow: BrowserWindow; event: IpcMainInvokeEvent } {
  const mainFrame = {};
  const webContents = { mainFrame };
  return {
    mainWindow: {
      isDestroyed: () => false,
      webContents,
    } as unknown as BrowserWindow,
    event: { sender: webContents, senderFrame: mainFrame } as IpcMainInvokeEvent,
  };
}

function invoke(event: unknown, request: unknown): unknown {
  if (!captured.handler) throw new Error('Expected usage IPC handler');
  return captured.handler(event, request);
}

beforeEach(() => {
  captured.channel = '';
  captured.handler = undefined;
});

describe('usage IPC handler', () => {
  it('normalizes a valid read-only statistics query before passing it to Main service', () => {
    const { mainWindow, event } = createAuthorizedWindow();
    const getStatistics = vi.fn(() => statistics);
    registerUsageIpcHandlers(
      () => mainWindow,
      { getStatistics } as unknown as UsageStatisticsService,
    );

    expect(invoke(event, {
      startAt: '2026-01-01T08:00:00+08:00',
      endAt: '2026-01-02T08:00:00+08:00',
      timeZone: 'Asia/Shanghai',
      taskType: 'translation',
      providerProfileId: 7,
      model: 'gpt-5-mini',
    })).toEqual({ ok: true, data: statistics });
    expect(getStatistics).toHaveBeenCalledWith({
      startAt: '2026-01-01T00:00:00.000Z',
      endAt: '2026-01-02T00:00:00.000Z',
      timeZone: 'Asia/Shanghai',
      taskType: 'translation',
      providerProfileId: 7,
      model: 'gpt-5-mini',
    });
    expect(captured.channel).toBe(USAGE_IPC_CHANNELS.statisticsGet);
  });

  it.each([
    { startAt: 'not-a-date', endAt: '2026-01-02T00:00:00.000Z', timeZone: 'UTC' },
    { startAt: '2026-01-02T00:00:00.000Z', endAt: '2026-01-02T00:00:00.000Z', timeZone: 'UTC' },
    { startAt: '2026-01-01T00:00:00.000Z', endAt: '2026-01-02T00:00:00.000Z', timeZone: 'Mars/Olympus' },
    { startAt: '2026-01-01T00:00:00.000Z', endAt: '2026-01-02T00:00:00.000Z', timeZone: 'UTC', taskType: 'inline' },
    { startAt: '2026-01-01T00:00:00.000Z', endAt: '2026-01-02T00:00:00.000Z', timeZone: 'UTC', providerProfileId: 0 },
  ])('rejects invalid query %# without reaching the service', (request) => {
    const { mainWindow, event } = createAuthorizedWindow();
    const getStatistics = vi.fn(() => statistics);
    registerUsageIpcHandlers(
      () => mainWindow,
      { getStatistics } as unknown as UsageStatisticsService,
    );

    expect(invoke(event, request)).toEqual({
      ok: false,
      error: {
        code: 'USAGE_INVALID_REQUEST',
        message: 'The usage statistics query is invalid.',
        retryable: false,
      },
    });
    expect(getStatistics).not.toHaveBeenCalled();
  });

  it('rejects an unauthorized sender without reading statistics', () => {
    const getStatistics = vi.fn(() => statistics);
    registerUsageIpcHandlers(
      () => null,
      { getStatistics } as unknown as UsageStatisticsService,
    );

    expect(invoke({}, {
      startAt: '2026-01-01T00:00:00.000Z',
      endAt: '2026-01-02T00:00:00.000Z',
      timeZone: 'UTC',
    })).toEqual({
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized IPC sender.',
        retryable: false,
      },
    });
    expect(getStatistics).not.toHaveBeenCalled();
  });
});
