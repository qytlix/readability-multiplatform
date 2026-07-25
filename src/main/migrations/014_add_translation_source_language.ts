import type Database from 'better-sqlite3';

/**
 * Keeps the current full-article Translation runtime compatible with databases
 * that already record an explicit source language. The current public request
 * contract remains auto-detect only, so new rows use `auto`.
 */
export function runMigration014(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(translation_result)').all() as Array<{
    name: string;
  }>;
  if (columns.some((column) => column.name === 'sourceLanguage')) return;

  db.exec(`
    ALTER TABLE translation_result
    ADD COLUMN sourceLanguage TEXT NOT NULL DEFAULT 'auto' CHECK (
      sourceLanguage IN ('auto', 'zh-CN', 'zh-HK', 'ja', 'ko', 'de', 'fr', 'es', 'en')
    );
  `);
}
