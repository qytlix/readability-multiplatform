import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { ProviderProfileStore } from '../../src/main/ai/stores/ProviderProfileStore';
import { TranslationStore } from '../../src/main/ai/stores/TranslationStore';
import { MIGRATION_001 } from '../../src/main/migrations/001_create_feeds';
import { MIGRATION_002 } from '../../src/main/migrations/002_create_entries';
import { MIGRATION_003 } from '../../src/main/migrations/003_create_contents';
import { MIGRATION_004 } from '../../src/main/migrations/004_add_feed_etag';
import { MIGRATION_006 } from '../../src/main/migrations/006_create_ai_profiles';
import { MIGRATION_007 } from '../../src/main/migrations/007_create_summary';
import { MIGRATION_008 } from '../../src/main/migrations/008_create_translation';
import { MIGRATION_009 } from '../../src/main/migrations/009_enhance_translation';
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
    expect(() => db.exec(MIGRATION_009)).not.toThrow();
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
      terminologyPackVersion: 'test-pack',
      segments: [
        { id: 'seg_0_one', orderIndex: 0, type: 'paragraph', sourceHtml: '<p>First</p>', sourceText: 'First' },
        { id: 'seg_1_two', orderIndex: 1, type: 'paragraph', sourceHtml: '<p>Second</p>', sourceText: 'Second' },
      ],
    });
    translationStore.markSegmentSucceeded(run.id, 'seg_0_one', '第一段', '<p>第一段</p>', []);
    translationStore.markSegmentSucceeded(run.id, 'seg_1_two', '第二段', '<p>第二段</p>', []);
    const result = translationStore.markRunSucceeded(run.id);

    expect(result.status).toBe('succeeded');
    expect(result.segments.map((segment) => segment.translatedText)).toEqual(['第一段', '第二段']);
    expect(translationStore.findCompatibleResult(
      1,
      'zh-CN',
      'source-hash',
      'v1',
      'translation-v1',
      'test-pack',
    )?.id).toBe(run.id);
  });

  it('reconciles interrupted Translation runs as retryable failures', () => {
    const run = translationStore.createRun({
      entryId: 1,
      providerProfileId,
      targetLanguage: 'en',
      sourceContentHash: 'source-hash',
      segmenterVersion: 'v1',
      promptVersion: 'translation-v1',
      terminologyPackVersion: 'test-pack',
      segments: [
        { id: 'seg_0_one', orderIndex: 0, type: 'paragraph', sourceHtml: '<p>First</p>', sourceText: 'First' },
      ],
    });

    translationStore.reconcileInterruptedRuns();

    expect(translationStore.findCompatibleResult(
      1,
      'en',
      'source-hash',
      'v1',
      'translation-v1',
      'test-pack',
    )).toMatchObject({
      id: run.id,
      status: 'failed',
      error: { code: 'TRANSLATION_INTERRUPTED', retryable: true },
    });
  });

  it('resumes only unfinished segments and preserves completed segment output', () => {
    const run = translationStore.createRun({
      entryId: 1,
      providerProfileId,
      targetLanguage: 'zh-CN',
      sourceContentHash: 'resume-hash',
      segmenterVersion: 'v1',
      promptVersion: 'translation-v1',
      terminologyPackVersion: 'test-pack',
      segments: [
        { id: 'seg_0_one', orderIndex: 0, type: 'paragraph', sourceHtml: '<p>First</p>', sourceText: 'First' },
        { id: 'seg_1_two', orderIndex: 1, type: 'paragraph', sourceHtml: '<p>Second</p>', sourceText: 'Second' },
      ],
    });
    translationStore.markSegmentSucceeded(run.id, 'seg_0_one', '第一段', '<p>第一段</p>', []);
    translationStore.markRunFailed(run.id, {
      code: 'TRANSLATION_PROVIDER_TIMEOUT',
      message: 'Timed out.',
      retryable: true,
    }, 'seg_1_two');

    const resumed = translationStore.resumeRun(run.id);

    expect(resumed).toMatchObject({
      status: 'running',
      error: undefined,
      segments: [
        { sourceSegmentId: 'seg_0_one', status: 'succeeded', translatedText: '第一段' },
        { sourceSegmentId: 'seg_1_two', status: 'pending', translatedText: undefined },
      ],
    });
  });
});
