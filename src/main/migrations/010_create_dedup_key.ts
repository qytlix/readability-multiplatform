import type Database from 'better-sqlite3';
import { normalizeFeedURL } from '../feed/services/FeedIdentity';

/**
 * Migration 010: Add dedupKey column to feed table.
 */

/** SQL step: add the column */
export const MIGRATION_010_SQL = `
ALTER TABLE feed ADD COLUMN dedupKey TEXT;
`;

/** JS step: backfill dedupKey for existing records and conditionally create UNIQUE index */
export function runMigration010(db: Database.Database): void {
  // Backfill dedupKey for existing records
  const rows = db
    .prepare('SELECT id, feedURL FROM feed WHERE dedupKey IS NULL')
    .all() as { id: number; feedURL: string }[];

  const update = db.prepare('UPDATE feed SET dedupKey = ? WHERE id = ?');
  for (const row of rows) {
    try {
      const dedupKey = normalizeFeedURL(row.feedURL);
      update.run(dedupKey, row.id);
    } catch {
      // If URL is invalid, skip it (shouldn't happen in practice)
      // Store a placeholder to avoid null conflicts
      update.run(row.feedURL, row.id);
    }
  }

  // Check for duplicates before creating UNIQUE index
  const duplicates = db
    .prepare(
      `SELECT dedupKey, COUNT(*) as cnt FROM feed
       WHERE dedupKey IS NOT NULL
       GROUP BY dedupKey HAVING cnt > 1`,
    )
    .all() as { dedupKey: string; cnt: number }[];

  if (duplicates.length > 0) {
    console.warn(
      `[Migration 010] Found ${duplicates.length} dedupKey collision(s), skipping UNIQUE index:`,
    );
    for (const dup of duplicates) {
      console.warn(`  dedupKey="${dup.dedupKey}" appears ${dup.cnt} times`);
    }
  } else {
    db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_dedupKey ON feed(dedupKey)',
    );
  }
}