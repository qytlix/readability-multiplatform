import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TranslationStore } from '../../src/main/ai/stores/TranslationStore';
import { DatabaseManager } from '../../src/main/database/DatabaseManager';
import { MIGRATION_001 } from '../../src/main/migrations/001_create_feeds';
import { MIGRATION_002 } from '../../src/main/migrations/002_create_entries';
import { MIGRATION_003 } from '../../src/main/migrations/003_create_contents';
import { MIGRATION_004 } from '../../src/main/migrations/004_add_feed_etag';
import { MIGRATION_005 } from '../../src/main/migrations/005_create_settings';
import { MIGRATION_006 } from '../../src/main/migrations/006_create_ai_profiles';
import { MIGRATION_007 } from '../../src/main/migrations/007_create_summary';
import { MIGRATION_008 } from '../../src/main/migrations/008_create_translation';
import { MIGRATION_009 } from '../../src/main/migrations/009_enhance_translation';
import {
  MIGRATION_010 as MIGRATION_010_READING_PROGRESS,
} from '../../src/main/migrations/010_add_entry_reading_progress';
import {
  MIGRATION_010_SQL,
  runMigration010,
} from '../../src/main/migrations/010_create_dedup_key';
import { MIGRATION_011 } from '../../src/main/migrations/011_create_entry_annotations';

interface LegacyMigration {
  id: string;
  sql: string;
  run?: (db: Database.Database) => void;
}

const LEGACY_MIGRATIONS: LegacyMigration[] = [
  { id: '001_create_feeds', sql: MIGRATION_001 },
  { id: '002_create_entries', sql: MIGRATION_002 },
  { id: '003_create_contents', sql: MIGRATION_003 },
  { id: '004_add_feed_etag', sql: MIGRATION_004 },
  { id: '005_create_settings', sql: MIGRATION_005 },
  { id: '006_create_ai_profiles', sql: MIGRATION_006 },
  { id: '007_create_summary', sql: MIGRATION_007 },
  { id: '008_create_translation', sql: MIGRATION_008 },
  { id: '009_enhance_translation', sql: MIGRATION_009 },
  { id: '010_add_entry_reading_progress', sql: MIGRATION_010_READING_PROGRESS },
  { id: '010_create_dedup_key', sql: MIGRATION_010_SQL, run: runMigration010 },
  { id: '011_create_entry_annotations', sql: MIGRATION_011 },
];

describe('Advanced Translation upgrade and restart hardening', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    temporaryDirectories.splice(0).forEach((directory) => {
      rmSync(directory, { recursive: true, force: true });
    });
  });

  it('upgrades an M0 database through 012-015, reconciles interruption, and restarts', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'shale-at-m6-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'shale.sqlite');
    createLegacyDatabase(databasePath);

    const upgraded = new DatabaseManager(databasePath);
    upgraded.runMigrations();
    const upgradedDb = upgraded.getDb();

    expect(upgradedDb.prepare(`
      SELECT id, providerPreset, apiKeyRef
      FROM ai_provider_profile WHERE id = 7
    `).get()).toEqual({
      id: 7,
      providerPreset: 'openai',
      apiKeyRef: 'opaque-secret-reference',
    });
    expect(upgradedDb.prepare(`
      SELECT id, sourceLanguage, targetLanguage, expertId, expertContentHash,
             smartContextEnabled, contextPromptVersion, status
      FROM translation_result WHERE id = 9
    `).get()).toEqual({
      id: 9,
      sourceLanguage: 'auto',
      targetLanguage: 'en',
      expertId: 'none',
      expertContentHash: 'none',
      smartContextEnabled: 0,
      contextPromptVersion: 'none',
      status: 'running',
    });
    expect(upgradedDb.prepare(`
      SELECT id, translationResultId, sourceSegmentId, status
      FROM translation_segment WHERE id = 11
    `).get()).toEqual({
      id: 11,
      translationResultId: 9,
      sourceSegmentId: 'legacy-segment',
      status: 'pending',
    });
    expect(upgradedDb.pragma('foreign_key_check')).toEqual([]);

    new TranslationStore(upgradedDb).reconcileInterruptedRuns();
    expect(upgradedDb.prepare(`
      SELECT status, errorCode, errorRetryable
      FROM translation_result WHERE id = 9
    `).get()).toEqual({
      status: 'failed',
      errorCode: 'TRANSLATION_INTERRUPTED',
      errorRetryable: 1,
    });
    upgraded.close();

    const restarted = new DatabaseManager(databasePath);
    restarted.runMigrations();
    try {
      expect(restarted.getDb().prepare(`
        SELECT status, errorCode FROM translation_result WHERE id = 9
      `).get()).toEqual({
        status: 'failed',
        errorCode: 'TRANSLATION_INTERRUPTED',
      });
      expect(restarted.getDb().prepare(`
        SELECT filename FROM _migrations
        WHERE filename >= '012_' ORDER BY filename
      `).all()).toEqual([
        { filename: '012_expand_ai_providers' },
        { filename: '013_expand_translation_languages' },
        { filename: '014_add_translation_context_and_experts' },
        { filename: '015_add_terminology_libraries' },
      ]);
      expect(restarted.getDb().prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'translation_context_cache',
          'translation_expert_user',
          'terminology_library_config',
          'terminology_library_user',
          'terminology_entry_user'
        )
        ORDER BY name
      `).all()).toEqual([
        { name: 'terminology_entry_user' },
        { name: 'terminology_library_config' },
        { name: 'terminology_library_user' },
        { name: 'translation_context_cache' },
        { name: 'translation_expert_user' },
      ]);
      expect(restarted.getDb().pragma('foreign_key_check')).toEqual([]);
    } finally {
      restarted.close();
    }
  });
});

function createLegacyDatabase(databasePath: string): void {
  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  try {
    database.exec(`
      CREATE TABLE _migrations (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        filename  TEXT NOT NULL UNIQUE,
        appliedAt TEXT NOT NULL
      )
    `);
    for (const migration of LEGACY_MIGRATIONS) {
      database.transaction(() => {
        database.exec(migration.sql);
        migration.run?.(database);
        database.prepare(`
          INSERT INTO _migrations (filename, appliedAt) VALUES (?, ?)
        `).run(migration.id, '2026-07-24T00:00:00.000Z');
      })();
    }

    database.prepare(`
      INSERT INTO feed (id, feedURL, dedupKey, createdAt)
      VALUES (1, 'https://example.com/feed', 'https://example.com/feed', ?)
    `).run('2026-07-24T00:00:00.000Z');
    database.prepare(`
      INSERT INTO entry (id, feedId, guid, title, createdAt, updatedAt)
      VALUES (1, 1, 'entry-1', 'Legacy entry', ?, ?)
    `).run('2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z');
    database.prepare(`
      INSERT INTO ai_provider_profile (
        id, providerKind, baseUrl, model, apiKeyRef, isActive, createdAt, updatedAt
      ) VALUES (
        7, 'openai-compatible', 'https://api.openai.com/v1', 'legacy-model',
        'opaque-secret-reference', 1, ?, ?
      )
    `).run('2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z');
    database.prepare(`
      INSERT INTO translation_result (
        id, entryId, providerProfileId, targetLanguage, sourceContentHash,
        segmenterVersion, promptVersion, terminologyPackVersion, status,
        createdAt, updatedAt
      ) VALUES (
        9, 1, 7, 'en', 'legacy-content-hash', 'content-segments-v2',
        'translation-v3', 'none', 'running', ?, ?
      )
    `).run('2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z');
    database.prepare(`
      INSERT INTO translation_segment (
        id, translationResultId, sourceSegmentId, orderIndex, sourceText,
        status, createdAt, updatedAt, sourceType, sourceHtml
      ) VALUES (
        11, 9, 'legacy-segment', 0, 'Legacy source', 'pending', ?, ?,
        'paragraph', '<p>Legacy source</p>'
      )
    `).run('2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z');
  } finally {
    database.close();
  }
}
