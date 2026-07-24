/**
 * Migration 013: Expand full-article Translation to an explicit source
 * language and eight target languages while preserving result/segment IDs.
 *
 * Both Translation tables are copied before either legacy table is dropped so
 * the child rows and their foreign-key relationship remain intact.
 */
export const MIGRATION_013 = `
CREATE TABLE translation_result_m2 (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    entryId           INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
    providerProfileId INTEGER NOT NULL REFERENCES ai_provider_profile(id),
    sourceLanguage    TEXT NOT NULL CHECK (
      sourceLanguage IN ('auto', 'zh-CN', 'zh-HK', 'ja', 'ko', 'de', 'fr', 'es', 'en')
    ),
    targetLanguage    TEXT NOT NULL CHECK (
      targetLanguage IN ('zh-CN', 'zh-HK', 'ja', 'ko', 'de', 'fr', 'es', 'en')
    ),
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
    terminologyPackVersion TEXT NOT NULL DEFAULT 'none',
    UNIQUE(
      entryId,
      sourceLanguage,
      targetLanguage,
      sourceContentHash,
      segmenterVersion
    )
);

CREATE TABLE translation_segment_m2 (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    translationResultId INTEGER NOT NULL
      REFERENCES translation_result_m2(id) ON DELETE CASCADE,
    sourceSegmentId   TEXT NOT NULL,
    orderIndex        INTEGER NOT NULL,
    sourceText        TEXT NOT NULL,
    translatedText    TEXT,
    status            TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
    errorCode         TEXT,
    errorMessage      TEXT,
    createdAt         TEXT NOT NULL,
    updatedAt         TEXT NOT NULL,
    sourceType        TEXT NOT NULL DEFAULT 'paragraph',
    sourceHtml        TEXT NOT NULL DEFAULT '',
    translatedHtml    TEXT,
    terminologyMatchesJson TEXT,
    UNIQUE(translationResultId, sourceSegmentId)
);

INSERT INTO translation_result_m2 (
  id, entryId, providerProfileId, sourceLanguage, targetLanguage,
  sourceContentHash, segmenterVersion, promptVersion, status,
  errorCode, errorMessage, errorRetryable, createdAt, completedAt, updatedAt,
  terminologyPackVersion
)
SELECT
  id, entryId, providerProfileId, 'auto', targetLanguage,
  sourceContentHash, segmenterVersion, promptVersion, status,
  errorCode, errorMessage, errorRetryable, createdAt, completedAt, updatedAt,
  terminologyPackVersion
FROM translation_result;

INSERT INTO translation_segment_m2 (
  id, translationResultId, sourceSegmentId, orderIndex, sourceText,
  translatedText, status, errorCode, errorMessage, createdAt, updatedAt,
  sourceType, sourceHtml, translatedHtml, terminologyMatchesJson
)
SELECT
  id, translationResultId, sourceSegmentId, orderIndex, sourceText,
  translatedText, status, errorCode, errorMessage, createdAt, updatedAt,
  sourceType, sourceHtml, translatedHtml, terminologyMatchesJson
FROM translation_segment;

DROP TABLE translation_segment;
DROP TABLE translation_result;

ALTER TABLE translation_result_m2 RENAME TO translation_result;
ALTER TABLE translation_segment_m2 RENAME TO translation_segment;

CREATE INDEX idx_translation_result_entry_language
  ON translation_result(entryId, sourceLanguage, targetLanguage, updatedAt DESC);

CREATE INDEX idx_translation_segment_order
  ON translation_segment(translationResultId, orderIndex);
`;
