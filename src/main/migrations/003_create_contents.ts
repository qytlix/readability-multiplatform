/** Migration 003: Create entry_content table */
export const MIGRATION_003 = `
CREATE TABLE IF NOT EXISTS entry_content (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    entryId             INTEGER NOT NULL UNIQUE REFERENCES entry(id) ON DELETE CASCADE,
    sourceHtml          TEXT,
    sourceUrl           TEXT,
    cleanedHtml         TEXT,
    cleanedMarkdown     TEXT,
    readabilityTitle    TEXT,
    readabilityByline   TEXT,
    readabilityVersion  INTEGER DEFAULT 0,
    markdownVersion     INTEGER DEFAULT 0,
    documentBaseURL     TEXT,
    pipelineStatus      TEXT NOT NULL DEFAULT 'pending',
    pipelineError       TEXT,
    segmenterVersion    TEXT,
    sourceContentHash   TEXT,
    createdAt           TEXT NOT NULL,
    updatedAt           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entry_content_entryId ON entry_content(entryId);
`;