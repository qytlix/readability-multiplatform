/**
 * Migration 020: Make tag name unique constraint case-sensitive.
 *
 * Previously tag.name had UNIQUE COLLATE NOCASE, preventing "Pi" and "pi"
 * from being distinct tags. This migration rebuilds the tag table without
 * COLLATE NOCASE.
 *
 * Since SQLite does not support ALTER COLUMN, we recreate the table.
 * We also keep the existing COLLATE NOCASE index on name; it's no longer
 * unique so duplicates won't be rejected, but the UNIQUE constraint on
 * the column itself already enforces case-sensitive uniqueness.
 */
export const MIGRATION_020 = `
PRAGMA foreign_keys = OFF;

CREATE TABLE tag_new (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT ''
);

INSERT INTO tag_new (id, name, color)
  SELECT id, name, color FROM tag;

DROP TABLE tag;

ALTER TABLE tag_new RENAME TO tag;

CREATE INDEX IF NOT EXISTS idx_tag_name ON tag(name);

PRAGMA foreign_keys = ON;
`;