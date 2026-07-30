import Database from 'better-sqlite3';
import { MIGRATION_001 } from '../migrations/001_create_feeds';
import { MIGRATION_002 } from '../migrations/002_create_entries';
import { MIGRATION_003 } from '../migrations/003_create_contents';
import { MIGRATION_004 } from '../migrations/004_add_feed_etag';
import { MIGRATION_005 } from '../migrations/005_create_settings';
import { MIGRATION_006 } from '../migrations/006_create_ai_profiles';
import { MIGRATION_007 } from '../migrations/007_create_summary';
import { MIGRATION_008 } from '../migrations/008_create_translation';
import { MIGRATION_009 } from '../migrations/009_enhance_translation';
import { MIGRATION_010 as MIGRATION_010_READING_PROGRESS } from '../migrations/010_add_entry_reading_progress';
import { MIGRATION_010_SQL, runMigration010 } from '../migrations/010_create_dedup_key';
import { MIGRATION_011 as MIGRATION_011_USAGE } from '../migrations/011_create_llm_usage_events';
import { MIGRATION_012 as MIGRATION_012_USAGE_ATTEMPT } from '../migrations/012_add_llm_usage_attempt_id';
import { MIGRATION_011 } from '../migrations/011_create_entry_annotations';
import { MIGRATION_012 } from '../migrations/012_expand_ai_providers';
import { MIGRATION_013 } from '../migrations/013_expand_translation_languages';
import { MIGRATION_014 } from '../migrations/014_add_translation_context_and_experts';
import { MIGRATION_015 } from '../migrations/015_add_terminology_libraries';
import { runMigration016 } from '../migrations/016_normalize_relative_entry_urls';
import { MIGRATION_017 } from '../migrations/017_add_translation_active_result';
import { runMigration017 } from '../migrations/017_normalize_entry_summaries';
import { MIGRATION_018 } from '../migrations/018_add_feed_content_html';
import {
  MIGRATION_019,
  rebuildEntrySearchIndex,
  registerEntrySearchFunctions,
} from '../migrations/019_create_entry_search_index';
import { MIGRATION_020 } from '../migrations/020_add_provider_task_models';
import { MIGRATION_021 } from '../migrations/021_add_translation_provider_route';
import { MIGRATION_022 } from '../migrations/022_create_entry_tags';
import { MIGRATION_023 } from '../migrations/023_tag_name_case_sensitive';
import { MIGRATION_024 } from '../migrations/024_add_tag_provider_route';
import { MIGRATION_025 } from '../migrations/025_add_entry_ai_tag_generated';
import { MIGRATION_026 } from '../migrations/026_add_translation_local_context';
import { MIGRATION_027 } from '../migrations/027_add_translation_result_variant';
import { MIGRATION_028 } from '../migrations/028_add_deep_translation_checkpoints';
import { MIGRATION_029 } from '../migrations/029_add_translation_context_usage_kind';

interface Migration {
  id: string;
  /** Raw SQL to execute (for simple migrations) */
  sql?: string;
  /** JS function to run (for complex migrations needing JS logic) */
  run?: (db: Database.Database) => void;
}

const MIGRATIONS: Migration[] = [
  { id: '001_create_feeds', sql: MIGRATION_001 },
  { id: '002_create_entries', sql: MIGRATION_002 },
  { id: '003_create_contents', sql: MIGRATION_003 },
  { id: '004_add_feed_etag', sql: MIGRATION_004 },
  { id: '005_create_settings', sql: MIGRATION_005 },
  { id: '006_create_ai_profiles', sql: MIGRATION_006 },
  { id: '007_create_summary', sql: MIGRATION_007 },
  { id: '008_create_translation', sql: MIGRATION_008 },
  { id: '009_enhance_translation', sql: MIGRATION_009 },
  {
    id: '010_add_entry_reading_progress',
    sql: MIGRATION_010_READING_PROGRESS,
  },
  { id: '010_create_dedup_key', sql: MIGRATION_010_SQL, run: runMigration010 },
  { id: '011_create_llm_usage_events', sql: MIGRATION_011_USAGE },
  { id: '012_add_llm_usage_attempt_id', sql: MIGRATION_012_USAGE_ATTEMPT },
  { id: '011_create_entry_annotations', sql: MIGRATION_011 },
  { id: '012_expand_ai_providers', sql: MIGRATION_012 },
  { id: '013_expand_translation_languages', sql: MIGRATION_013 },
  { id: '014_add_translation_context_and_experts', sql: MIGRATION_014 },
  { id: '015_add_terminology_libraries', sql: MIGRATION_015 },
  { id: '016_normalize_relative_entry_urls', run: runMigration016 },
  { id: '017_add_translation_active_result', sql: MIGRATION_017 },
  { id: '017_normalize_entry_summaries', run: runMigration017 },
  { id: '018_add_feed_content_html', sql: MIGRATION_018 },
  {
    id: '019_create_entry_search_index',
    sql: MIGRATION_019,
    run: rebuildEntrySearchIndex,
  },
  { id: '020_add_provider_task_models', sql: MIGRATION_020 },
  { id: '021_add_translation_provider_route', sql: MIGRATION_021 },
  { id: '022_create_entry_tags', sql: MIGRATION_022 },
  { id: '023_tag_name_case_sensitive', sql: MIGRATION_023 },
  { id: '024_add_tag_provider_route', sql: MIGRATION_024 },
  { id: '025_add_entry_ai_tag_generated', sql: MIGRATION_025 },
  { id: '026_add_translation_local_context', sql: MIGRATION_026 },
  { id: '027_add_translation_result_variant', sql: MIGRATION_027 },
  { id: '028_add_deep_translation_checkpoints', sql: MIGRATION_028 },
  { id: '029_add_translation_context_usage_kind', sql: MIGRATION_029 },
];

export class DatabaseManager {
  private db: Database.Database;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath ?? ':memory:');

    // WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    registerEntrySearchFunctions(this.db);
  }

  /**
   * Run all pending migrations in order.
   */
  runMigrations(): void {
    // Ensure migrations tracking table exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        filename  TEXT NOT NULL UNIQUE,
        appliedAt TEXT NOT NULL
      )
    `);

    const rows = this.db
      .prepare('SELECT filename FROM _migrations ORDER BY id')
      .all() as { filename: string }[];
    const applied = new Set(rows.map((r) => r.filename));

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) continue;

      this.db.transaction(() => {
        if (migration.sql) {
          this.db.exec(migration.sql);
        }
        // Run JS callback if present (after SQL for composite migrations)
        if (migration.run) {
          migration.run(this.db);
        }
        this.db
          .prepare('INSERT INTO _migrations (filename, appliedAt) VALUES (?, ?)')
          .run(migration.id, new Date().toISOString());
      })();
    }
  }

  /**
   * Get the underlying better-sqlite3 Database instance.
   */
  getDb(): Database.Database {
    return this.db;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}
