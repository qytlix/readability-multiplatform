/** Migration 001: Create feeds table */
export const MIGRATION_001 = `
CREATE TABLE IF NOT EXISTS feed (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    title            TEXT,
    feedURL          TEXT NOT NULL UNIQUE,
    siteURL          TEXT,
    feedParserVersion INTEGER,
    lastFetchedAt    TEXT,
    lastSyncStatus   TEXT DEFAULT 'never',
    lastSyncError    TEXT,
    syncIntervalMin  INTEGER DEFAULT 30,
    createdAt        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feed_feedURL ON feed(feedURL);
`;