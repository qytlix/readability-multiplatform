import { beforeEach, describe, expect, it } from 'vitest';
import SqliteDatabase from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { ProviderProfileStore } from '../../src/main/ai/stores/ProviderProfileStore';
import { UsageStore } from '../../src/main/ai/stores/UsageStore';
import { MIGRATION_011 } from '../../src/main/migrations/011_create_llm_usage_events';
import { MIGRATION_012 } from '../../src/main/migrations/012_add_llm_usage_attempt_id';
import { MIGRATION_029 } from '../../src/main/migrations/029_expand_usage_for_chat';
import { buildTestDbWithData } from '../fixtures/databases/feed-fixture';

describe('UsageStore', () => {
  let database: Database.Database;
  let usageStore: UsageStore;
  let providerProfileId: number;

  beforeEach(() => {
    const { db } = buildTestDbWithData();
    database = db;
    providerProfileId = new ProviderProfileStore(db).saveActive({
      providerKind: 'openai',
      baseUrl: 'https://provider.example/v1',
      model: 'usage-test-model',
      apiKeyRef: 'usage-test-key',
    }).id;
    usageStore = new UsageStore(db);
  });

  it('stores one request record with reported, partial, and missing Provider usage', () => {
    usageStore.createRunning({
      providerRequestId: 1001,
      attemptId: 'summary-attempt-1',
      taskType: 'summary',
      taskRunId: 71,
      providerProfileId,
      model: 'usage-test-model',
      requestKind: 'summary',
    });
    usageStore.finish(1001, 'succeeded', {
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
    });

    usageStore.createRunning({
      providerRequestId: 1002,
      attemptId: 'translation-attempt-1',
      taskType: 'translation',
      // Translation uses its own table, so this deliberately has no task-table FK.
      taskRunId: 998_877,
      providerProfileId,
      model: 'usage-test-model',
      requestKind: 'batch',
    });
    usageStore.finish(1002, 'failed', { inputTokens: 5, outputTokens: 3 }, 'TRANSLATION_TIMEOUT');

    usageStore.createRunning({
      providerRequestId: 1003,
      attemptId: 'translation-attempt-1',
      taskType: 'translation',
      taskRunId: 998_877,
      providerProfileId,
      model: 'usage-test-model',
      requestKind: 'compensation',
    });
    usageStore.finish(1003, 'failed', undefined, 'TRANSLATION_NETWORK_ERROR');

    expect(usageStore.findByProviderRequestId(1001)).toMatchObject({
      taskType: 'summary',
      taskRunId: 71,
      attemptId: 'summary-attempt-1',
      requestStatus: 'succeeded',
      requestKind: 'summary',
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      usageAvailability: 'reported',
    });
    expect(usageStore.listByTask('translation', 998_877)).toMatchObject([
      {
        providerRequestId: 1002,
        attemptId: 'translation-attempt-1',
        requestStatus: 'failed',
        errorCode: 'TRANSLATION_TIMEOUT',
        inputTokens: 5,
        outputTokens: 3,
        usageAvailability: 'partial',
      },
      {
        providerRequestId: 1003,
        attemptId: 'translation-attempt-1',
        requestKind: 'compensation',
        requestStatus: 'failed',
        errorCode: 'TRANSLATION_NETWORK_ERROR',
        usageAvailability: 'missing',
      },
    ]);
  });

  it('stores Chat answer and context-analysis request kinds', () => {
    usageStore.createRunning({
      providerRequestId: 2001,
      attemptId: 'chat-attempt-1',
      taskType: 'chat',
      taskRunId: 81,
      providerProfileId,
      model: 'usage-test-model',
      requestKind: 'chat-answer',
    });
    usageStore.finish(2001, 'succeeded', { inputTokens: 30, outputTokens: 10 });
    usageStore.createRunning({
      providerRequestId: 2002,
      attemptId: 'chat-attempt-1',
      taskType: 'chat',
      taskRunId: 81,
      providerProfileId,
      model: 'usage-test-model',
      requestKind: 'chat-segment-analysis',
    });
    usageStore.finish(2002, 'succeeded', undefined);

    expect(usageStore.listByTask('chat', 81)).toMatchObject([
      { requestKind: 'chat-answer', inputTokens: 30, outputTokens: 10 },
      { requestKind: 'chat-segment-analysis', usageAvailability: 'missing' },
    ]);
  });

  it('recovers abandoned running requests as interrupted without changing recorded tokens', () => {
    usageStore.createRunning({
      providerRequestId: 1004,
      attemptId: 'summary-attempt-2',
      taskType: 'summary',
      taskRunId: 72,
      providerProfileId,
      model: 'usage-test-model',
      requestKind: 'summary',
    });

    expect(usageStore.reconcileInterruptedRunning()).toBe(1);
    expect(usageStore.findByProviderRequestId(1004)).toMatchObject({
      requestStatus: 'interrupted',
      errorCode: 'AI_INTERRUPTED',
      usageAvailability: 'missing',
      finishedAt: expect.any(String),
    });
  });

  it('does not create a taskRunId foreign key while retaining the provider profile foreign key', () => {
    const foreignKeys = database.prepare('PRAGMA foreign_key_list(llm_usage_event)').all() as Array<{
      from: string;
      table: string;
    }>;

    expect(foreignKeys.map(({ from, table }) => ({ from, table }))).toEqual([
      { from: 'providerProfileId', table: 'ai_provider_profile' },
    ]);
  });

  it('adds attemptId without changing legacy usage rows', () => {
    const legacyDatabase = new SqliteDatabase(':memory:');
    legacyDatabase.exec('CREATE TABLE ai_provider_profile (id INTEGER PRIMARY KEY)');
    legacyDatabase.exec('INSERT INTO ai_provider_profile (id) VALUES (1)');
    legacyDatabase.exec(MIGRATION_011);
    legacyDatabase.prepare(`
      INSERT INTO llm_usage_event
        (providerRequestId, taskType, taskRunId, providerProfileId, model,
         requestKind, requestStatus, usageAvailability, startedAt)
      VALUES (99, 'summary', 9, 1, 'legacy-model', 'summary', 'succeeded', 'missing', ?)
    `).run('2026-07-01T00:00:00.000Z');

    legacyDatabase.exec(MIGRATION_012);
    legacyDatabase.exec(MIGRATION_029);

    const columns = legacyDatabase.prepare('PRAGMA table_info(llm_usage_event)')
      .all() as Array<{ name: string }>;
    expect(columns.map(({ name }) => name)).toContain('attemptId');
    expect(legacyDatabase.prepare('SELECT attemptId FROM llm_usage_event WHERE providerRequestId = 99')
      .get()).toEqual({ attemptId: null });
    legacyDatabase.close();
  });
});
