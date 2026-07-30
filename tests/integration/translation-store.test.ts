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
  let db: Database.Database;

  beforeEach(() => {
    ({ db } = buildTestDbWithData());
    const profiles = new ProviderProfileStore(db);
    providerProfileId = profiles.saveActive({
      providerKind: 'openai',
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
      sourceLanguage: 'auto',
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
      'auto',
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
      sourceLanguage: 'auto',
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
      'auto',
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

  it('does not revive an older paused run after a newer product run succeeds', () => {
    const createRun = (translationVariant: 'standard' | 'deep') => translationStore.createRun({
      entryId: 1,
      providerProfileId,
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN',
      sourceContentHash: 'canonical-task-hash',
      segmenterVersion: 'v1',
      promptVersion: 'translation-v1',
      terminologyPackVersion: 'none',
      translationVariant,
      segments: [{
        id: 'seg_0', orderIndex: 0, type: 'paragraph',
        sourceHtml: '<p>Source</p>', sourceText: 'Source',
      }],
    });
    const paused = createRun('deep');
    translationStore.saveDeepBatchCheckpoint(paused.id, {
      batchKey: 'seg_0', stage: 'rewrite', draftJson: '[]', reviewJson: '{"issues":[]}',
    });
    translationStore.markRunPaused(paused.id, {
      code: 'TRANSLATION_PAUSED', message: 'Paused.', retryable: true,
    });
    const completed = createRun('standard');
    translationStore.markSegmentSucceeded(completed.id, 'seg_0', '完成', '<p>完成</p>', []);
    translationStore.markRunSucceeded(completed.id);

    expect(translationStore.findLatestPendingProductResult(
      1, 'auto', 'zh-CN', 'canonical-task-hash', 'v1',
    )).toBeUndefined();
    expect(translationStore.findDeepBatchCheckpoint(paused.id, 'seg_0')).toBeUndefined();
    expect(translationStore.findLatestActiveProductResult(
      1, 'auto', 'zh-CN', 'canonical-task-hash', 'v1',
    )?.id).toBe(completed.id);
  });

  it('reconciles terminal success over residual pause metadata and checkpoints', () => {
    const run = translationStore.createRun({
      entryId: 1,
      providerProfileId,
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN',
      sourceContentHash: 'terminal-reconcile-hash',
      segmenterVersion: 'v1',
      promptVersion: 'translation-v1',
      terminologyPackVersion: 'none',
      translationVariant: 'deep',
      segments: [{
        id: 'seg_0', orderIndex: 0, type: 'paragraph',
        sourceHtml: '<p>Source</p>', sourceText: 'Source',
      }],
    });
    translationStore.markSegmentSucceeded(run.id, 'seg_0', '完成', '<p>完成</p>', []);
    translationStore.markRunSucceeded(run.id);
    db.prepare(`
      UPDATE translation_result
      SET errorCode = 'TRANSLATION_PAUSED', errorMessage = 'Stale pause',
          errorRetryable = 1, completedAt = NULL
      WHERE id = ?
    `).run(run.id);
    translationStore.saveDeepBatchCheckpoint(run.id, {
      batchKey: 'seg_0', stage: 'rewrite', draftJson: '[]', reviewJson: '{"issues":[]}',
    });

    expect(translationStore.reconcileInterruptedRuns()).toBe(0);

    expect(translationStore.findLatestActiveProductResult(
      1, 'auto', 'zh-CN', 'terminal-reconcile-hash', 'v1',
    )).toMatchObject({ id: run.id, status: 'succeeded', error: undefined });
    expect(translationStore.findDeepBatchCheckpoint(run.id, 'seg_0')).toBeUndefined();
    expect(db.prepare(`
      SELECT errorCode, errorMessage, errorRetryable, completedAt
      FROM translation_result WHERE id = ?
    `).get(run.id)).toMatchObject({
      errorCode: null, errorMessage: null, errorRetryable: null,
      completedAt: expect.any(String),
    });
  });

  it('persists expert and smart-context identity plus a non-fatal context warning', () => {
    const run = translationStore.createRun({
      entryId: 1,
      providerProfileId,
      sourceLanguage: 'en',
      targetLanguage: 'de',
      sourceContentHash: 'expert-context-hash',
      segmenterVersion: 'v2',
      promptVersion: 'translation-v5',
      terminologyPackVersion: 'none',
      expertId: 'paper',
      expertContentHash: 'expert-content-a',
      smartContextEnabled: true,
      contextPromptVersion: 'translation-context-v1',
      segments: [{
        id: 'seg_0',
        orderIndex: 0,
        type: 'paragraph',
        sourceHtml: '<p>Source</p>',
        sourceText: 'Source',
      }],
    });
    translationStore.setContextWarning(run.id, {
      code: 'TRANSLATION_CONTEXT_UNAVAILABLE',
      message: 'Context failed, translation continued.',
      retryable: true,
    });

    expect(translationStore.findCompatibleResult(
      1,
      'en',
      'de',
      'expert-context-hash',
      'v2',
      'translation-v5',
      'none',
      'paper',
      'expert-content-a',
      true,
      'translation-context-v1',
    )).toMatchObject({
      expertId: 'paper',
      expertContentHash: 'expert-content-a',
      smartContextEnabled: true,
      contextPromptVersion: 'translation-context-v1',
      contextWarning: {
        code: 'TRANSLATION_CONTEXT_UNAVAILABLE',
        retryable: true,
      },
    });
    expect(translationStore.findCompatibleResult(
      1,
      'en',
      'de',
      'expert-context-hash',
      'v2',
      'translation-v5',
      'none',
      'paper',
      'expert-content-b',
      true,
      'translation-context-v1',
    )).toBeUndefined();
  });

  it('does not reuse legacy result variants as standard candidates', () => {
    const createRun = () => translationStore.createRun({
      entryId: 1,
      providerProfileId,
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      sourceContentHash: 'variant-hash',
      segmenterVersion: 'v2',
      promptVersion: 'translation-v8-target-language-validation',
      terminologyPackVersion: 'none',
      segments: [{
        id: 'seg_0',
        orderIndex: 0,
        type: 'paragraph',
        sourceHtml: '<p>Source</p>',
        sourceText: 'Source',
      }],
    });
    const legacy = createRun();
    translationStore.markSegmentSucceeded(
      legacy.id,
      'seg_0',
      '标准译文',
      '<p>标准译文</p>',
      [],
    );
    translationStore.markRunSucceeded(legacy.id);
    db.prepare(`
      UPDATE translation_result SET translationVariant = 'legacy-pre-mode' WHERE id = ?
    `).run(legacy.id);

    const standard = createRun();
    translationStore.markRunFailed(standard.id, {
      code: 'TRANSLATION_PROVIDER_TIMEOUT',
      message: 'Standard candidate timed out.',
      retryable: true,
    });

    expect(translationStore.findCompatibleResult(
      1, 'en', 'zh-CN', 'variant-hash', 'v2',
      'translation-v8-target-language-validation', 'none', 'none', 'none', false, 'none',
    )).toMatchObject({ id: standard.id, translationVariant: 'standard', status: 'failed' });
    expect(translationStore.findLatestActiveResult(
      1, 'en', 'zh-CN', 'variant-hash', 'v2',
    )).toBeUndefined();
  });

  it('keeps standard and deep active results separate while making deep failures terminal', () => {
    const createRun = (translationVariant: 'standard' | 'deep') => translationStore.createRun({
      entryId: 1,
      providerProfileId,
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      sourceContentHash: 'mode-hash',
      segmenterVersion: 'v2',
      promptVersion: 'translation-v8-target-language-validation',
      terminologyPackVersion: 'none',
      translationVariant,
      segments: [{
        id: 'seg_0', orderIndex: 0, type: 'paragraph', sourceHtml: '<p>Source</p>', sourceText: 'Source',
      }],
    });
    const standard = createRun('standard');
    const deep = createRun('deep');
    translationStore.saveDeepBatchCheckpoint(deep.id, {
      batchKey: 'seg_0',
      stage: 'rewrite',
      draftJson: '[{"sourceSegmentId":"seg_0"}]',
      reviewJson: '{"issues":[]}',
    });
    translationStore.markSegmentSucceeded(deep.id, 'seg_0', '未发布深度候选', '<p>未发布深度候选</p>', []);
    translationStore.markRunFailed(deep.id, {
      code: 'TRANSLATION_INTERRUPTED', message: 'Interrupted.', retryable: true,
    });
    expect(translationStore.findDeepBatchCheckpoint(deep.id, 'seg_0')).toBeUndefined();
    expect(translationStore.findCompatibleResult(
      1, 'en', 'zh-CN', 'mode-hash', 'v2',
      'translation-v8-target-language-validation', 'none', 'none', 'none', false, 'none', 'deep',
    )?.segments).toEqual([
      expect.objectContaining({ status: 'pending', translatedText: undefined }),
    ]);
    expect(() => translationStore.resumeRun(deep.id, providerProfileId))
      .toThrow('Deep Translation runs cannot be resumed.');
    translationStore.markSegmentSucceeded(standard.id, 'seg_0', '标准', '<p>标准</p>', []);
    translationStore.markRunSucceeded(standard.id);
    const replacementDeep = createRun('deep');
    translationStore.markSegmentSucceeded(replacementDeep.id, 'seg_0', '深度', '<p>深度</p>', []);
    translationStore.markRunSucceeded(replacementDeep.id);

    expect(translationStore.findLatestActiveResult(
      1, 'en', 'zh-CN', 'mode-hash', 'v2', 'standard',
    )?.id).toBe(standard.id);
    expect(translationStore.findLatestActiveResult(
      1, 'en', 'zh-CN', 'mode-hash', 'v2', 'deep',
    )?.id).toBe(replacementDeep.id);
    expect(translationStore.findDeepBatchCheckpoint(deep.id, 'seg_0')).toBeUndefined();
  });

  it('converges a legacy deep pause into a terminal failure and removes its checkpoint', () => {
    const run = translationStore.createRun({
      entryId: 1,
      providerProfileId,
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN',
      sourceContentHash: 'legacy-deep-pause-hash',
      segmenterVersion: 'v1',
      promptVersion: 'translation-v1',
      terminologyPackVersion: 'none',
      translationVariant: 'deep',
      segments: [{
        id: 'seg_0', orderIndex: 0, type: 'paragraph',
        sourceHtml: '<p>Source</p>', sourceText: 'Source',
      }],
    });
    translationStore.saveDeepBatchCheckpoint(run.id, {
      batchKey: 'seg_0', stage: 'review', draftJson: '[]',
    });
    translationStore.markRunPaused(run.id, {
      code: 'TRANSLATION_PAUSED', message: 'Paused by an older build.', retryable: true,
    });
    // Recreate the stale checkpoint shape because current terminal writes
    // already clean it defensively.
    translationStore.saveDeepBatchCheckpoint(run.id, {
      batchKey: 'seg_0', stage: 'review', draftJson: '[]',
    });

    const reconciled = translationStore.reconcileInterruptedRunsWithDiagnostics();

    expect(reconciled).toEqual({ interruptedCount: 0, canonicalCorrectionCount: 1 });
    expect(translationStore.findLatestPendingProductResult(
      1, 'auto', 'zh-CN', 'legacy-deep-pause-hash', 'v1',
    )).toBeUndefined();
    expect(translationStore.findCompatibleResult(
      1, 'auto', 'zh-CN', 'legacy-deep-pause-hash', 'v1',
      'translation-v1', 'none', 'none', 'none', false, 'none', 'deep',
    )).toMatchObject({
      id: run.id,
      status: 'failed',
      error: { code: 'TRANSLATION_INTERRUPTED', retryable: true },
    });
    expect(translationStore.findDeepBatchCheckpoint(run.id, 'seg_0')).toBeUndefined();
  });

  it('preserves an active deep fallback when a replacement deep candidate fails', () => {
    const createDeepRun = () => translationStore.createRun({
      entryId: 1,
      providerProfileId,
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN',
      sourceContentHash: 'deep-fallback-hash',
      segmenterVersion: 'v1',
      promptVersion: 'translation-v1',
      terminologyPackVersion: 'none',
      translationVariant: 'deep',
      segments: [{
        id: 'seg_0', orderIndex: 0, type: 'paragraph',
        sourceHtml: '<p>Source</p>', sourceText: 'Source',
      }],
    });
    const previous = createDeepRun();
    translationStore.markSegmentSucceeded(
      previous.id, 'seg_0', '旧深度译文', '<p>旧深度译文</p>', [],
    );
    translationStore.markRunSucceeded(previous.id);
    const candidate = createDeepRun();
    translationStore.markSegmentSucceeded(
      candidate.id, 'seg_0', '未发布候选', '<p>未发布候选</p>', [],
    );

    translationStore.markRunFailed(candidate.id, {
      code: 'TRANSLATION_PROVIDER_TIMEOUT', message: 'Timed out.', retryable: true,
    });

    expect(translationStore.findLatestActiveResult(
      1, 'auto', 'zh-CN', 'deep-fallback-hash', 'v1', 'deep',
    )).toMatchObject({
      id: previous.id,
      status: 'succeeded',
      segments: [{ translatedText: '旧深度译文', status: 'succeeded' }],
    });
    expect(translationStore.findCompatibleResult(
      1, 'auto', 'zh-CN', 'deep-fallback-hash', 'v1',
      'translation-v1', 'none', 'none', 'none', false, 'none', 'deep',
    )).toMatchObject({
      id: candidate.id,
      status: 'failed',
      segments: [{ translatedText: undefined, status: 'pending' }],
    });
  });

  it('resumes only unfinished segments and preserves completed segment output', () => {
    const run = translationStore.createRun({
      entryId: 1,
      providerProfileId,
      sourceLanguage: 'auto',
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

  it('keeps the active result through failed candidates and atomically activates a complete replacement', () => {
    const createRun = () => translationStore.createRun({
      entryId: 1,
      providerProfileId,
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN',
      sourceContentHash: 'replacement-hash',
      segmenterVersion: 'v1',
      promptVersion: 'translation-v1',
      terminologyPackVersion: 'test-pack',
      segments: [
        { id: 'title', orderIndex: 0, type: 'title', sourceHtml: '<h1>Title</h1>', sourceText: 'Title' },
        { id: 'body', orderIndex: 1, type: 'paragraph', sourceHtml: '<p>Body</p>', sourceText: 'Body' },
      ],
    });
    const complete = (runId: number, marker: string) => {
      translationStore.markSegmentSucceeded(runId, 'title', `${marker} title`, `<h1>${marker} title</h1>`, []);
      translationStore.markSegmentSucceeded(runId, 'body', `${marker} body`, `<p>${marker} body</p>`, []);
      return translationStore.markRunSucceeded(runId);
    };

    const original = complete(createRun().id, 'original');
    const failedCandidate = createRun();
    translationStore.markRunFailed(failedCandidate.id, {
      code: 'TRANSLATION_INVALID_STRUCTURE',
      message: 'Candidate response was invalid.',
      retryable: true,
    });

    expect(translationStore.findActiveCompatibleResult(
      1, 'auto', 'zh-CN', 'replacement-hash', 'v1', 'translation-v1', 'test-pack',
    )).toMatchObject({
      id: original.id,
      segments: [
        { translatedText: 'original title' },
        { translatedText: 'original body' },
      ],
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM translation_result').get())
      .toEqual({ count: 2 });

    const replacement = complete(createRun().id, 'replacement');
    expect(translationStore.findActiveCompatibleResult(
      1, 'auto', 'zh-CN', 'replacement-hash', 'v1', 'translation-v1', 'test-pack',
    )?.id).toBe(replacement.id);
    expect(db.prepare('SELECT isActive FROM translation_result WHERE id = ?').get(original.id))
      .toEqual({ isActive: 0 });
    expect(db.prepare('SELECT isActive FROM translation_result WHERE id = ?').get(failedCandidate.id))
      .toEqual({ isActive: 0 });
  });

  it('does not activate incomplete candidates or alter another target language', () => {
    const createRun = (targetLanguage: 'zh-CN' | 'en') => translationStore.createRun({
      entryId: 1,
      providerProfileId,
      sourceLanguage: 'auto',
      targetLanguage,
      sourceContentHash: 'language-isolation-hash',
      segmenterVersion: 'v1',
      promptVersion: 'translation-v1',
      terminologyPackVersion: 'test-pack',
      segments: [
        { id: 'first', orderIndex: 0, type: 'paragraph', sourceHtml: '<p>First</p>', sourceText: 'First' },
        { id: 'second', orderIndex: 1, type: 'paragraph', sourceHtml: '<p>Second</p>', sourceText: 'Second' },
      ],
    });
    const complete = (runId: number, marker: string) => {
      translationStore.markSegmentSucceeded(runId, 'first', `${marker} first`, `<p>${marker} first</p>`, []);
      translationStore.markSegmentSucceeded(runId, 'second', `${marker} second`, `<p>${marker} second</p>`, []);
      return translationStore.markRunSucceeded(runId);
    };

    const english = complete(createRun('en').id, 'english');
    const originalChinese = complete(createRun('zh-CN').id, 'original');
    const incompleteChinese = createRun('zh-CN');
    translationStore.markSegmentSucceeded(
      incompleteChinese.id,
      'first',
      'candidate first',
      '<p>candidate first</p>',
      [],
    );

    expect(() => translationStore.markRunSucceeded(incompleteChinese.id))
      .toThrow('cannot be activated before every segment succeeds');
    expect(translationStore.findActiveCompatibleResult(
      1, 'auto', 'zh-CN', 'language-isolation-hash', 'v1', 'translation-v1', 'test-pack',
    )?.id).toBe(originalChinese.id);
    expect(translationStore.findActiveCompatibleResult(
      1, 'auto', 'en', 'language-isolation-hash', 'v1', 'translation-v1', 'test-pack',
    )?.id).toBe(english.id);

    const replacement = complete(createRun('zh-CN').id, 'replacement');
    expect(translationStore.findActiveCompatibleResult(
      1, 'auto', 'zh-CN', 'language-isolation-hash', 'v1', 'translation-v1', 'test-pack',
    )?.id).toBe(replacement.id);
    expect(translationStore.findActiveCompatibleResult(
      1, 'auto', 'en', 'language-isolation-hash', 'v1', 'translation-v1', 'test-pack',
    )?.id).toBe(english.id);
  });
});
