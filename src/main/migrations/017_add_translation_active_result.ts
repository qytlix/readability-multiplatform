/**
 * Migration 017: retain Translation runs and mark the effective successful
 * result explicitly. A fresh run can therefore be prepared without removing
 * the result currently shown by Reader or used by export.
 */
export const MIGRATION_017 = `
CREATE TABLE translation_result_m3 (
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
    terminologyPackVersion TEXT NOT NULL DEFAULT 'none',
    expertId          TEXT NOT NULL DEFAULT 'none',
    expertContentHash TEXT NOT NULL DEFAULT 'none',
    smartContextEnabled INTEGER NOT NULL DEFAULT 0 CHECK (smartContextEnabled IN (0, 1)),
    contextPromptVersion TEXT NOT NULL DEFAULT 'none',
    contextWarningCode TEXT,
    contextWarningMessage TEXT,
    contextWarningRetryable INTEGER,
    status            TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    isActive          INTEGER NOT NULL DEFAULT 0 CHECK (isActive IN (0, 1)),
    errorCode         TEXT,
    errorMessage      TEXT,
    errorRetryable    INTEGER,
    createdAt         TEXT NOT NULL,
    completedAt       TEXT,
    updatedAt         TEXT NOT NULL
);

CREATE TABLE translation_segment_m3 (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    translationResultId INTEGER NOT NULL
      REFERENCES translation_result_m3(id) ON DELETE CASCADE,
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

INSERT INTO translation_result_m3 (
  id, entryId, providerProfileId, sourceLanguage, targetLanguage,
  sourceContentHash, segmenterVersion, promptVersion, terminologyPackVersion,
  expertId, expertContentHash, smartContextEnabled, contextPromptVersion,
  contextWarningCode, contextWarningMessage, contextWarningRetryable,
  status, isActive, errorCode, errorMessage, errorRetryable,
  createdAt, completedAt, updatedAt
)
SELECT
  id, entryId, providerProfileId, sourceLanguage, targetLanguage,
  sourceContentHash, segmenterVersion, promptVersion, terminologyPackVersion,
  expertId, expertContentHash, smartContextEnabled, contextPromptVersion,
  contextWarningCode, contextWarningMessage, contextWarningRetryable,
  status, CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END,
  errorCode, errorMessage, errorRetryable, createdAt, completedAt, updatedAt
FROM translation_result;

INSERT INTO translation_segment_m3 (
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

ALTER TABLE translation_result_m3 RENAME TO translation_result;
ALTER TABLE translation_segment_m3 RENAME TO translation_segment;

CREATE INDEX idx_translation_result_entry_language
  ON translation_result(entryId, sourceLanguage, targetLanguage, updatedAt DESC);
CREATE INDEX idx_translation_result_active
  ON translation_result(
    entryId,
    sourceLanguage,
    targetLanguage,
    sourceContentHash,
    segmenterVersion,
    promptVersion,
    terminologyPackVersion,
    expertId,
    expertContentHash,
    smartContextEnabled,
    contextPromptVersion,
    completedAt DESC
  ) WHERE isActive = 1 AND status = 'succeeded';
CREATE INDEX idx_translation_segment_order
  ON translation_segment(translationResultId, orderIndex);
`;
