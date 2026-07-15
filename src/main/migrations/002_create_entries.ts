/** Migration 002: Create entries table */
export const MIGRATION_002 = `
CREATE TABLE IF NOT EXISTS entry (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    feedId        INTEGER NOT NULL REFERENCES feed(id) ON DELETE CASCADE,
    guid          TEXT,
    url           TEXT,
    title         TEXT,
    author        TEXT,
    publishedAt   TEXT,
    summary       TEXT,
    isRead        INTEGER NOT NULL DEFAULT 0,
    isStarred     INTEGER NOT NULL DEFAULT 0,
    isDeleted     INTEGER NOT NULL DEFAULT 0,
    contentHash   TEXT,
    createdAt     TEXT NOT NULL,
    updatedAt     TEXT NOT NULL,

    UNIQUE(feedId, guid),
    UNIQUE(feedId, url)
);

CREATE INDEX IF NOT EXISTS idx_entry_feedId ON entry(feedId);
CREATE INDEX IF NOT EXISTS idx_entry_guid ON entry(guid);
CREATE INDEX IF NOT EXISTS idx_entry_url ON entry(url);
CREATE INDEX IF NOT EXISTS idx_entry_publishedAt ON entry(publishedAt DESC);
CREATE INDEX IF NOT EXISTS idx_entry_feed_published ON entry(feedId, publishedAt DESC);
CREATE INDEX IF NOT EXISTS idx_entry_isRead ON entry(isRead);
CREATE INDEX IF NOT EXISTS idx_entry_isStarred ON entry(isStarred) WHERE isStarred = 1;
`;