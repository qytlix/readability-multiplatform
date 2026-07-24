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
import { MIGRATION_011 } from '../migrations/011_create_entry_annotations';

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
  { id: '011_create_entry_annotations', sql: MIGRATION_011 },
];

export class DatabaseManager {
  private db: Database.Database;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath ?? ':memory:');

    // WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
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
