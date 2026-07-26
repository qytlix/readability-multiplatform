import type Database from 'better-sqlite3';
import { normalizeFeedSummary } from '../feed/parser/FeedSummary';

interface EntrySummaryRow {
  id: number;
  summary: string;
}

/**
 * Repair summaries persisted before feed HTML was normalized at parse time.
 */
export function runMigration017(db: Database.Database): void {
  const rows = db.prepare(`
    SELECT id, summary
    FROM entry
    WHERE summary IS NOT NULL
  `).all() as EntrySummaryRow[];
  const updateSummary = db.prepare('UPDATE entry SET summary = ? WHERE id = ?');

  for (const row of rows) {
    const normalizedSummary = normalizeFeedSummary(row.summary);
    if (normalizedSummary === row.summary) continue;
    updateSummary.run(normalizedSummary ?? null, row.id);
  }
}
