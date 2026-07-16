import Database from 'better-sqlite3';
import { MIGRATION_001 } from '../migrations/001_create_feeds';
import { MIGRATION_002 } from '../migrations/002_create_entries';
import { MIGRATION_003 } from '../migrations/003_create_contents';
import { MIGRATION_004 } from '../migrations/004_add_feed_etag';
import { MIGRATION_006 } from '../migrations/006_create_ai_profiles';
import { MIGRATION_007 } from '../migrations/007_create_summary';
import { MIGRATION_008 } from '../migrations/008_create_translation';

interface Migration {
  id: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  { id: '001_create_feeds', sql: MIGRATION_001 },
  { id: '002_create_entries', sql: MIGRATION_002 },
  { id: '003_create_contents', sql: MIGRATION_003 },
  { id: '004_add_feed_etag', sql: MIGRATION_004 },
  { id: '006_create_ai_profiles', sql: MIGRATION_006 },
  { id: '007_create_summary', sql: MIGRATION_007 },
  { id: '008_create_translation', sql: MIGRATION_008 },
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
        this.db.exec(migration.sql);
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
