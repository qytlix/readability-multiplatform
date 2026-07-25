import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MIGRATION_001 } from '../../src/main/migrations/001_create_feeds';
import { MIGRATION_002 } from '../../src/main/migrations/002_create_entries';
import { MIGRATION_003 } from '../../src/main/migrations/003_create_contents';
import { MIGRATION_006 } from '../../src/main/migrations/006_create_ai_profiles';
import { MIGRATION_008 } from '../../src/main/migrations/008_create_translation';
import { MIGRATION_009 } from '../../src/main/migrations/009_enhance_translation';
import { MIGRATION_013 } from '../../src/main/migrations/013_expand_translation_languages';
import { MIGRATION_014 } from '../../src/main/migrations/014_add_translation_context_and_experts';

describe('Translation language and advanced-feature migrations', () => {
  it('preserves legacy results and segment foreign keys while expanding languages', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    try {
      db.exec(MIGRATION_001);
      db.exec(MIGRATION_002);
      db.exec(MIGRATION_003);
      db.exec(MIGRATION_006);
      db.exec(MIGRATION_008);
      db.exec(MIGRATION_009);
      seedLegacyTranslation(db);

      expect(() => db.transaction(() => db.exec(MIGRATION_013))()).not.toThrow();

      expect(db.prepare(`
        SELECT id, sourceLanguage, targetLanguage
        FROM translation_result WHERE id = 7
      `).get()).toEqual({
        id: 7,
        sourceLanguage: 'auto',
        targetLanguage: 'en',
      });
      expect(db.prepare(`
        SELECT id, translationResultId, sourceSegmentId
        FROM translation_segment WHERE id = 11
      `).get()).toEqual({
        id: 11,
        translationResultId: 7,
        sourceSegmentId: 'legacy-segment',
      });
      expect(db.pragma('foreign_key_check')).toEqual([]);

      expect(() => db.prepare(`
        INSERT INTO translation_result (
          entryId, providerProfileId, sourceLanguage, targetLanguage,
          sourceContentHash, segmenterVersion, promptVersion,
          terminologyPackVersion, status, createdAt, updatedAt
        ) VALUES (1, 1, 'ja', 'zh-HK', 'same-hash', 'v2', 'v4', 'none',
                  'succeeded', '2026-07-24', '2026-07-24')
      `).run()).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('adds context and expert storage while preserving existing Translation results', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    try {
      db.exec(MIGRATION_001);
      db.exec(MIGRATION_002);
      db.exec(MIGRATION_003);
      db.exec(MIGRATION_006);
      db.exec(MIGRATION_008);
      db.exec(MIGRATION_009);
      seedLegacyTranslation(db);
      db.transaction(() => db.exec(MIGRATION_013))();

      expect(() => db.transaction(() => db.exec(MIGRATION_014))()).not.toThrow();

      expect(db.prepare(`
        SELECT id, expertId, expertContentHash, smartContextEnabled,
               contextPromptVersion
        FROM translation_result WHERE id = 7
      `).get()).toEqual({
        id: 7,
        expertId: 'none',
        expertContentHash: 'none',
        smartContextEnabled: 0,
        contextPromptVersion: 'none',
      });
      expect(db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'translation_expert_user',
          'translation_context_cache'
        )
        ORDER BY name
      `).all()).toEqual([
        { name: 'translation_context_cache' },
        { name: 'translation_expert_user' },
      ]);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });
});

function seedLegacyTranslation(db: Database.Database): void {
  db.prepare(`
    INSERT INTO feed (id, feedURL, createdAt)
    VALUES (1, 'https://example.com/feed', '2026-07-24')
  `).run();
  db.prepare(`
    INSERT INTO entry (id, feedId, guid, createdAt, updatedAt)
    VALUES (1, 1, 'entry-1', '2026-07-24', '2026-07-24')
  `).run();
  db.prepare(`
    INSERT INTO ai_provider_profile (
      id, providerKind, baseUrl, model, apiKeyRef, isActive, createdAt, updatedAt
    ) VALUES (
      1, 'openai-compatible', 'https://provider.example/v1', 'model',
      'secret-ref', 1, '2026-07-24', '2026-07-24'
    )
  `).run();
  db.prepare(`
    INSERT INTO translation_result (
      id, entryId, providerProfileId, targetLanguage, sourceContentHash,
      segmenterVersion, promptVersion, terminologyPackVersion,
      status, createdAt, updatedAt
    ) VALUES (
      7, 1, 1, 'en', 'legacy-hash', 'v1', 'legacy-prompt', 'none',
      'succeeded', '2026-07-24', '2026-07-24'
    )
  `).run();
  db.prepare(`
    INSERT INTO translation_segment (
      id, translationResultId, sourceSegmentId, orderIndex, sourceText,
      translatedText, status, createdAt, updatedAt, sourceType, sourceHtml,
      translatedHtml
    ) VALUES (
      11, 7, 'legacy-segment', 0, '旧内容', 'Legacy content',
      'succeeded', '2026-07-24', '2026-07-24', 'paragraph',
      '<p>旧内容</p>', '<p>Legacy content</p>'
    )
  `).run();
}
