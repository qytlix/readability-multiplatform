import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { ProviderProfileStore } from '../../src/main/ai/ProviderProfileStore';
import { TranslationStore } from '../../src/main/ai/TranslationStore';
import { MIGRATION_001 } from '../../src/main/migrations/001_create_feeds';
import { MIGRATION_002 } from '../../src/main/migrations/002_create_entries';
import { MIGRATION_003 } from '../../src/main/migrations/003_create_contents';
import { MIGRATION_004 } from '../../src/main/migrations/004_add_feed_etag';
import { MIGRATION_006 } from '../../src/main/migrations/006_create_ai_profiles';
import { MIGRATION_007 } from '../../src/main/migrations/007_create_summary';
import { MIGRATION_008 } from '../../src/main/migrations/008_create_translation';
import { buildTestDbWithData } from '../fixtures/databases/feed-fixture';

describe('TranslationStore', () => {
  let translationStore: TranslationStore;
  let providerProfileId: number;

  beforeEach(() => {
    const { db } = buildTestDbWithData();
    const profiles = new ProviderProfileStore(db);
    providerProfileId = profiles.saveActive({
      baseUrl: 'https://provider.example/v1',
      model: 'example-model',
      apiKeyRef: 'secret-reference',
    }).id;
    translationStore = new TranslationStore(db);
  });

  it('upgrades the existing Summary schema without recreating entry_content', () => {
    const db = new Database(':memory:');
    db.exec(MIGRATION_001);
    db.exec(MIGRATION_002);
    db.exec(MIGRATION_003);
    db.exec(MIGRATION_004);
    db.exec(MIGRATION_006);
    db.exec(MIGRATION_007);

    expect(() => db.exec(MIGRATION_008)).not.toThrow();
    const contentColumns = db.prepare('PRAGMA table_info(entry_content)').all() as Array<{ name: string }>;
    expect(contentColumns.map((column) => column.name)).toContain('segmentsJson');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'translation_result'").get())
      .toBeDefined();
  });

  it('persists paragraph-aligned segments and completes the compatible slot', () => {
    const run = translationStore.createRun({
      entryId: 1,
      providerProfileId,
      targetLanguage: 'zh-CN',
      sourceContentHash: 'source-hash',
      segmenterVersion: 'v1',
      promptVersion: 'translation-v1',
      segments: [
        { id: 'seg_0_one', orderIndex: 0, type: 'p', sourceHtml: '<p>First</p>', sourceText: 'First' },
        { id: 'seg_1_two', orderIndex: 1, type: 'p', sourceHtml: '<p>Second</p>', sourceText: 'Second' },
      ],
    });
    translationStore.markSegmentSucceeded(run.id, 'seg_0_one', '第一段');
    translationStore.markSegmentSucceeded(run.id, 'seg_1_two', '第二段');
    const result = translationStore.markRunSucceeded(run.id);

    expect(result.status).toBe('succeeded');
    expect(result.segments.map((segment) => segment.translatedText)).toEqual(['第一段', '第二段']);
    expect(translationStore.findCompatibleResult(1, 'zh-CN', 'source-hash', 'v1')?.id).toBe(run.id);
  });

  it('reconciles interrupted Translation runs as retryable failures', () => {
    const run = translationStore.createRun({
      entryId: 1,
      providerProfileId,
      targetLanguage: 'en',
      sourceContentHash: 'source-hash',
      segmenterVersion: 'v1',
      promptVersion: 'translation-v1',
      segments: [
        { id: 'seg_0_one', orderIndex: 0, type: 'p', sourceHtml: '<p>First</p>', sourceText: 'First' },
      ],
    });

    translationStore.reconcileInterruptedRuns();

    expect(translationStore.findCompatibleResult(1, 'en', 'source-hash', 'v1')).toMatchObject({
      id: run.id,
      status: 'failed',
      error: { code: 'TRANSLATION_INTERRUPTED', retryable: true },
    });
  });
});
