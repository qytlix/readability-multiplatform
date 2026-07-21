/** Migration 008: Persist Translation P0 runs and paragraph-aligned results. */
export const MIGRATION_008 = `
ALTER TABLE entry_content ADD COLUMN segmentsJson TEXT;

CREATE TABLE IF NOT EXISTS translation_result (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    entryId           INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
    providerProfileId INTEGER NOT NULL REFERENCES ai_provider_profile(id),
    targetLanguage    TEXT NOT NULL CHECK (targetLanguage IN ('zh-CN', 'en')),
    sourceContentHash TEXT NOT NULL,
    segmenterVersion  TEXT NOT NULL,
    promptVersion     TEXT NOT NULL,
    status            TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    errorCode         TEXT,
    errorMessage      TEXT,
    errorRetryable    INTEGER,
    createdAt         TEXT NOT NULL,
    completedAt       TEXT,
    updatedAt         TEXT NOT NULL,
    UNIQUE(entryId, targetLanguage, sourceContentHash, segmenterVersion)
);

CREATE INDEX IF NOT EXISTS idx_translation_result_entry_language
  ON translation_result(entryId, targetLanguage, updatedAt DESC);

CREATE TABLE IF NOT EXISTS translation_segment (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    translationResultId INTEGER NOT NULL REFERENCES translation_result(id) ON DELETE CASCADE,
    sourceSegmentId   TEXT NOT NULL,
    orderIndex        INTEGER NOT NULL,
    sourceText        TEXT NOT NULL,
    translatedText    TEXT,
    status            TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
    errorCode         TEXT,
    errorMessage      TEXT,
    createdAt         TEXT NOT NULL,
    updatedAt         TEXT NOT NULL,
    UNIQUE(translationResultId, sourceSegmentId)
);

CREATE INDEX IF NOT EXISTS idx_translation_segment_order
  ON translation_segment(translationResultId, orderIndex);
`;
