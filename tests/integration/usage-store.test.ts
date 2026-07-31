import { beforeEach, describe, expect, it } from 'vitest';
import SqliteDatabase from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { ProviderProfileStore } from '../../src/main/ai/stores/ProviderProfileStore';
import { UsageStore } from '../../src/main/ai/stores/UsageStore';
import { MIGRATION_011 } from '../../src/main/migrations/011_create_llm_usage_events';
import { MIGRATION_012 } from '../../src/main/migrations/012_add_llm_usage_attempt_id';
import { MIGRATION_028 as MIGRATION_028_TRANSLATION } from '../../src/main/migrations/028_add_deep_translation_checkpoints';
import { MIGRATION_029 as MIGRATION_029_TRANSLATION } from '../../src/main/migrations/029_add_translation_context_usage_kind';
import { MIGRATION_029 as MIGRATION_029_CHAT } from '../../src/main/migrations/029_expand_usage_for_chat';
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
    legacyDatabase.exec(MIGRATION_029_TRANSLATION);

    const columns = legacyDatabase.prepare('PRAGMA table_info(llm_usage_event)')
      .all() as Array<{ name: string }>;
    expect(columns.map(({ name }) => name)).toContain('attemptId');
    expect(legacyDatabase.prepare('SELECT attemptId FROM llm_usage_event WHERE providerRequestId = 99')
      .get()).toEqual({ attemptId: null });
    legacyDatabase.close();
  });

  it('adds the Translation context request kind with a forward-only ledger rebuild', () => {
    const legacyDatabase = new SqliteDatabase(':memory:');
    legacyDatabase.exec('PRAGMA foreign_keys = ON');
    legacyDatabase.exec('CREATE TABLE ai_provider_profile (id INTEGER PRIMARY KEY)');
    legacyDatabase.exec('INSERT INTO ai_provider_profile (id) VALUES (1)');
    legacyDatabase.exec(`
      CREATE TABLE llm_usage_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        providerRequestId INTEGER NOT NULL UNIQUE,
        taskType TEXT NOT NULL CHECK (taskType IN ('summary', 'translation')),
        taskRunId INTEGER NOT NULL,
        providerProfileId INTEGER NOT NULL REFERENCES ai_provider_profile(id),
        model TEXT NOT NULL,
        requestKind TEXT NOT NULL CHECK (requestKind IN (
          'summary', 'batch', 'compensation',
          'deep-draft', 'deep-review', 'deep-rewrite',
          'deep-draft-compensation', 'deep-rewrite-compensation'
        )),
        requestStatus TEXT NOT NULL CHECK (requestStatus IN ('running', 'succeeded', 'failed', 'interrupted')),
        errorCode TEXT,
        inputTokens INTEGER,
        outputTokens INTEGER,
        totalTokens INTEGER,
        usageAvailability TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        finishedAt TEXT,
        attemptId TEXT
      );
      INSERT INTO llm_usage_event
        (providerRequestId, taskType, taskRunId, providerProfileId, model,
         requestKind, requestStatus, usageAvailability, startedAt, attemptId)
      VALUES (91, 'translation', 9, 1, 'legacy-model', 'deep-draft',
              'succeeded', 'missing', '2026-07-01T00:00:00.000Z', 'attempt-legacy');
    `);

    legacyDatabase.exec(MIGRATION_029_TRANSLATION);
    const migratedStore = new UsageStore(legacyDatabase);
    migratedStore.createRunning({
      providerRequestId: 92,
      attemptId: 'attempt-context',
      taskType: 'translation',
      taskRunId: 9,
      providerProfileId: 1,
      model: 'context-model',
      requestKind: 'translation-context',
    });

    expect(migratedStore.listByTask('translation', 9).map((record) => record.requestKind))
      .toEqual(['deep-draft', 'translation-context']);
    legacyDatabase.close();
  });

  it('preserves deep Translation usage while adding Article Chat request kinds', () => {
    const mainDatabase = new SqliteDatabase(':memory:');
    mainDatabase.exec('PRAGMA foreign_keys = ON');
    mainDatabase.exec('CREATE TABLE ai_provider_profile (id INTEGER PRIMARY KEY)');
    mainDatabase.exec('INSERT INTO ai_provider_profile (id) VALUES (1)');
    mainDatabase.exec(`
      CREATE TABLE llm_usage_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        providerRequestId INTEGER NOT NULL UNIQUE,
        taskType TEXT NOT NULL CHECK (taskType IN ('summary', 'translation')),
        taskRunId INTEGER NOT NULL,
        providerProfileId INTEGER NOT NULL REFERENCES ai_provider_profile(id),
        model TEXT NOT NULL,
        requestKind TEXT NOT NULL CHECK (requestKind IN (
          'summary', 'translation-context', 'batch', 'compensation',
          'deep-draft', 'deep-review', 'deep-rewrite',
          'deep-draft-compensation', 'deep-rewrite-compensation'
        )),
        requestStatus TEXT NOT NULL CHECK (
          requestStatus IN ('running', 'succeeded', 'failed', 'interrupted')
        ),
        errorCode TEXT,
        inputTokens INTEGER,
        outputTokens INTEGER,
        totalTokens INTEGER,
        usageAvailability TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        finishedAt TEXT,
        attemptId TEXT
      );
      INSERT INTO llm_usage_event
        (providerRequestId, taskType, taskRunId, providerProfileId, model,
         requestKind, requestStatus, usageAvailability, startedAt, attemptId)
      VALUES (301, 'translation', 31, 1, 'deep-model', 'deep-draft',
              'succeeded', 'missing', '2026-07-31T00:00:00.000Z', 'deep-attempt');
    `);

    mainDatabase.exec(MIGRATION_029_CHAT);
    const migratedStore = new UsageStore(mainDatabase);
    migratedStore.createRunning({
      providerRequestId: 302,
      attemptId: 'chat-attempt',
      taskType: 'chat',
      taskRunId: 32,
      providerProfileId: 1,
      model: 'chat-model',
      requestKind: 'chat-answer',
    });

    expect(mainDatabase.prepare(`
      SELECT providerRequestId, requestKind FROM llm_usage_event ORDER BY providerRequestId
    `).all()).toEqual([
      { providerRequestId: 301, requestKind: 'deep-draft' },
      { providerRequestId: 302, requestKind: 'chat-answer' },
    ]);
    mainDatabase.close();
  });

  it('preserves Article Chat usage through the deep Translation migrations', () => {
    const chatDatabase = new SqliteDatabase(':memory:');
    chatDatabase.exec('PRAGMA foreign_keys = ON');
    chatDatabase.exec('CREATE TABLE ai_provider_profile (id INTEGER PRIMARY KEY)');
    chatDatabase.exec('INSERT INTO ai_provider_profile (id) VALUES (1)');
    chatDatabase.exec(`
      CREATE TABLE llm_usage_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        providerRequestId INTEGER NOT NULL UNIQUE,
        taskType TEXT NOT NULL CHECK (taskType IN ('summary', 'translation', 'chat')),
        taskRunId INTEGER NOT NULL,
        providerProfileId INTEGER NOT NULL REFERENCES ai_provider_profile(id),
        model TEXT NOT NULL,
        requestKind TEXT NOT NULL CHECK (requestKind IN (
          'summary', 'batch', 'compensation',
          'chat-answer', 'chat-history-compression',
          'chat-segment-analysis', 'chat-article-map'
        )),
        requestStatus TEXT NOT NULL CHECK (
          requestStatus IN ('running', 'succeeded', 'failed', 'interrupted')
        ),
        errorCode TEXT,
        inputTokens INTEGER,
        outputTokens INTEGER,
        totalTokens INTEGER,
        usageAvailability TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        finishedAt TEXT,
        attemptId TEXT
      );
      INSERT INTO llm_usage_event
        (providerRequestId, taskType, taskRunId, providerProfileId, model,
         requestKind, requestStatus, usageAvailability, startedAt, attemptId)
      VALUES (401, 'chat', 41, 1, 'chat-model', 'chat-answer',
              'succeeded', 'missing', '2026-07-31T00:00:00.000Z', 'chat-attempt');
    `);

    chatDatabase.exec(MIGRATION_028_TRANSLATION);
    chatDatabase.exec(MIGRATION_029_TRANSLATION);
    const migratedStore = new UsageStore(chatDatabase);
    migratedStore.createRunning({
      providerRequestId: 402,
      attemptId: 'context-attempt',
      taskType: 'translation',
      taskRunId: 42,
      providerProfileId: 1,
      model: 'translation-model',
      requestKind: 'translation-context',
    });

    expect(chatDatabase.prepare(`
      SELECT providerRequestId, requestKind FROM llm_usage_event ORDER BY providerRequestId
    `).all()).toEqual([
      { providerRequestId: 401, requestKind: 'chat-answer' },
      { providerRequestId: 402, requestKind: 'translation-context' },
    ]);
    chatDatabase.close();
  });
});
