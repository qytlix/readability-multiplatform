/**
 * Migration 028: cache deterministic formatted article context and optional
 * model-produced segment analyses/article maps.
 */
export const MIGRATION_028 = `
CREATE TABLE IF NOT EXISTS ai_article_context_cache (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    entryId              INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
    sourceContentHash    TEXT NOT NULL,
    promptVersion        TEXT NOT NULL,
    compressionVersion   TEXT NOT NULL,
    analysisModelFamily  TEXT NOT NULL,
    formattedContext     TEXT NOT NULL,
    articleMap           TEXT,
    segmentAnalysesJson  TEXT,
    estimatedTokens      INTEGER NOT NULL CHECK (estimatedTokens >= 0),
    createdAt            TEXT NOT NULL,
    updatedAt            TEXT NOT NULL,
    UNIQUE (
      entryId,
      sourceContentHash,
      promptVersion,
      compressionVersion,
      analysisModelFamily
    )
);

CREATE INDEX IF NOT EXISTS idx_ai_article_context_entry_updated
  ON ai_article_context_cache(entryId, updatedAt DESC);
`;
