/**
 * Migration 019: Manual tags for entries.
 *
 * Creates the `tag` and `entry_tag` tables to support Phase 1 manual tagging.
 */
export const MIGRATION_019 = `
CREATE TABLE IF NOT EXISTS tag (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS entry_tag (
  entryId   INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
  tagId     INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  source    TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
  createdAt TEXT NOT NULL,
  PRIMARY KEY (entryId, tagId)
);

CREATE INDEX IF NOT EXISTS idx_entry_tag_entry ON entry_tag(entryId);
CREATE INDEX IF NOT EXISTS idx_entry_tag_tag   ON entry_tag(tagId);
CREATE INDEX IF NOT EXISTS idx_tag_name        ON tag(name);
`;