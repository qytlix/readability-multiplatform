import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { UsageStatisticsService } from '../../src/main/ai/services/UsageStatisticsService';
import { ProviderProfileStore } from '../../src/main/ai/stores/ProviderProfileStore';
import {
  type UsageRequestStatus,
  UsageStore,
} from '../../src/main/ai/stores/UsageStore';
import { buildTestDbWithData } from '../fixtures/databases/feed-fixture';

describe('UsageStatisticsService', () => {
  let database: Database.Database;
  let usageStore: UsageStore;
  let statisticsService: UsageStatisticsService;
  let firstProfileId: number;
  let secondProfileId: number;

  beforeEach(() => {
    const { db } = buildTestDbWithData();
    database = db;
    firstProfileId = new ProviderProfileStore(db).saveActive({
      baseUrl: 'https://provider-one.example/v1',
      model: 'shared-model',
      apiKeyRef: 'usage-one',
    }).id;
    secondProfileId = Number(db.prepare(`
      INSERT INTO ai_provider_profile
        (providerKind, baseUrl, model, apiKeyRef, isActive, createdAt, updatedAt)
      VALUES ('openai-compatible', 'https://provider-two.example/v1', 'shared-model',
              'usage-two', 0, ?, ?)
    `).run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z').lastInsertRowid);
    usageStore = new UsageStore(db);
    statisticsService = new UsageStatisticsService(usageStore);

    persistUsage({
      providerRequestId: 1,
      attemptId: 'attempt-summary',
      taskType: 'summary',
      taskRunId: 101,
      providerProfileId: firstProfileId,
      model: 'shared-model',
      requestKind: 'summary',
      requestStatus: 'succeeded',
      inputTokens: 5,
      outputTokens: 2,
      totalTokens: 7,
      startedAt: '2026-01-01T23:30:00.000Z',
    });
    persistUsage({
      providerRequestId: 2,
      attemptId: 'attempt-translation',
      taskType: 'translation',
      taskRunId: 102,
      providerProfileId: firstProfileId,
      model: 'shared-model',
      requestKind: 'batch',
      requestStatus: 'failed',
      inputTokens: 3,
      startedAt: '2026-01-02T00:15:00.000Z',
    });
    persistUsage({
      providerRequestId: 3,
      attemptId: 'attempt-translation',
      taskType: 'translation',
      taskRunId: 102,
      providerProfileId: secondProfileId,
      model: 'shared-model',
      requestKind: 'compensation',
      requestStatus: 'interrupted',
      inputTokens: 4,
      outputTokens: 1,
      totalTokens: 5,
      startedAt: '2026-01-02T01:00:00.000Z',
    });
    persistUsage({
      providerRequestId: 4,
      taskType: 'summary',
      taskRunId: 103,
      providerProfileId: secondProfileId,
      model: 'other-model',
      requestKind: 'summary',
      requestStatus: 'succeeded',
      startedAt: '2026-01-02T02:00:00.000Z',
    });
    persistUsage({
      providerRequestId: 5,
      attemptId: 'outside-range',
      taskType: 'summary',
      taskRunId: 104,
      providerProfileId: secondProfileId,
      model: 'other-model',
      requestKind: 'summary',
      requestStatus: 'succeeded',
      startedAt: '2026-01-03T00:00:00.000Z',
    });
  });

  it('aggregates reported usage, coverage, failed and interrupted requests without estimating NULL tokens', () => {
    const statistics = statisticsService.getStatistics({
      startAt: '2026-01-01T00:00:00.000Z',
      endAt: '2026-01-03T00:00:00.000Z',
      timeZone: 'UTC',
    });

    expect(statistics.totals).toEqual({
      requestCount: 4,
      requestStatus: { running: 0, succeeded: 2, failed: 1, interrupted: 1 },
      tokenTotals: { inputTokens: 12, outputTokens: 3, totalTokens: 12 },
      tokenCoverage: {
        inputTokens: 3,
        outputTokens: 2,
        totalTokens: 2,
        reportedRequests: 2,
        partialRequests: 1,
        missingRequests: 1,
      },
      attemptCoverage: {
        knownAttemptCount: 2,
        unassignedRequestCount: 1,
      },
    });
    expect(statistics.byTaskType).toEqual([
      expect.objectContaining({
        taskType: 'summary',
        requestCount: 2,
        attemptCoverage: { knownAttemptCount: 1, unassignedRequestCount: 1 },
      }),
      expect.objectContaining({
        taskType: 'translation',
        requestCount: 2,
        attemptCoverage: { knownAttemptCount: 1, unassignedRequestCount: 0 },
      }),
    ]);
    expect(statistics.byModel).toEqual([
      expect.objectContaining({
        providerProfileId: firstProfileId,
        model: 'shared-model',
        requestCount: 2,
        attemptCoverage: { knownAttemptCount: 2, unassignedRequestCount: 0 },
      }),
      expect.objectContaining({
        providerProfileId: secondProfileId,
        model: 'other-model',
        requestCount: 1,
        attemptCoverage: { knownAttemptCount: 0, unassignedRequestCount: 1 },
      }),
      expect.objectContaining({
        providerProfileId: secondProfileId,
        model: 'shared-model',
        requestCount: 1,
      }),
    ]);
    expect(statistics.byDay).toEqual([
      expect.objectContaining({
        day: '2026-01-01',
        requestCount: 1,
        attemptCoverage: { knownAttemptCount: 1, unassignedRequestCount: 0 },
      }),
      expect.objectContaining({
        day: '2026-01-02',
        requestCount: 3,
        attemptCoverage: { knownAttemptCount: 1, unassignedRequestCount: 1 },
      }),
    ]);
  });

  it('uses the requested IANA time zone for daily buckets and applies exclusive end boundaries', () => {
    const statistics = statisticsService.getStatistics({
      startAt: '2026-01-01T00:00:00.000Z',
      endAt: '2026-01-03T00:00:00.000Z',
      timeZone: 'Asia/Shanghai',
    });

    expect(statistics.byDay).toEqual([
      expect.objectContaining({ day: '2026-01-02', requestCount: 4 }),
    ]);
    expect(statistics.totals.requestCount).toBe(4);
  });

  it('filters by task type, provider profile, and exact model text', () => {
    const baseQuery = {
      startAt: '2026-01-01T00:00:00.000Z',
      endAt: '2026-01-03T00:00:00.000Z',
      timeZone: 'UTC',
    };
    expect(statisticsService.getStatistics({ ...baseQuery, taskType: 'translation' })
      .totals.requestCount).toBe(2);
    expect(statisticsService.getStatistics({ ...baseQuery, providerProfileId: firstProfileId })
      .totals.requestCount).toBe(2);
    expect(statisticsService.getStatistics({ ...baseQuery, model: 'shared-model' })
      .totals.requestCount).toBe(3);
    expect(statisticsService.getStatistics({
      ...baseQuery,
      taskType: 'translation',
      providerProfileId: firstProfileId,
      model: 'shared-model',
    }).totals).toMatchObject({
      requestCount: 1,
      requestStatus: { failed: 1 },
      tokenTotals: { inputTokens: 3, outputTokens: 0, totalTokens: 0 },
      tokenCoverage: { inputTokens: 1, outputTokens: 0, totalTokens: 0, partialRequests: 1 },
    });
  });

  function persistUsage(params: {
    providerRequestId: number;
    attemptId?: string;
    taskType: 'summary' | 'translation';
    taskRunId: number;
    providerProfileId: number;
    model: string;
    requestKind: 'summary' | 'batch' | 'compensation';
    requestStatus: Exclude<UsageRequestStatus, 'running'>;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    startedAt: string;
  }): void {
    usageStore.createRunning({
      ...params,
      attemptId: params.attemptId ?? 'legacy-attempt-placeholder',
    });
    usageStore.finish(params.providerRequestId, params.requestStatus, {
      ...(params.inputTokens === undefined ? {} : { inputTokens: params.inputTokens }),
      ...(params.outputTokens === undefined ? {} : { outputTokens: params.outputTokens }),
      ...(params.totalTokens === undefined ? {} : { totalTokens: params.totalTokens }),
    });
    database.prepare(`
      UPDATE llm_usage_event SET startedAt = ?, finishedAt = ? WHERE providerRequestId = ?
    `).run(params.startedAt, params.startedAt, params.providerRequestId);
    if (!params.attemptId) {
      database.prepare(`
        UPDATE llm_usage_event SET attemptId = NULL WHERE providerRequestId = ?
      `).run(params.providerRequestId);
    }
  }
});
