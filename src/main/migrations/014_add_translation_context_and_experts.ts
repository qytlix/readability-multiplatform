/** Migration 014: User AI experts and document-level Translation context. */
export const MIGRATION_014 = `
CREATE TABLE translation_expert_user (
    id           TEXT PRIMARY KEY,
    version      TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    author       TEXT NOT NULL DEFAULT '',
    details      TEXT NOT NULL DEFAULT '',
    instruction  TEXT NOT NULL,
    contentHash  TEXT NOT NULL,
    matchesJson  TEXT NOT NULL DEFAULT '[]',
    warningsJson TEXT NOT NULL DEFAULT '[]',
    sourceYaml   TEXT NOT NULL,
    createdAt    TEXT NOT NULL,
    updatedAt    TEXT NOT NULL
);

CREATE TABLE translation_context_cache (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    sourceContentHash   TEXT NOT NULL,
    sourceLanguage      TEXT NOT NULL CHECK (
      sourceLanguage IN ('auto', 'zh-CN', 'zh-HK', 'ja', 'ko', 'de', 'fr', 'es', 'en')
    ),
    targetLanguage      TEXT NOT NULL CHECK (
      targetLanguage IN ('zh-CN', 'zh-HK', 'ja', 'ko', 'de', 'fr', 'es', 'en')
    ),
    providerProfileId   INTEGER NOT NULL REFERENCES ai_provider_profile(id),
    providerModel       TEXT NOT NULL,
    expertId            TEXT NOT NULL,
    expertContentHash   TEXT NOT NULL,
    promptVersion       TEXT NOT NULL,
    contextJson         TEXT NOT NULL,
    createdAt           TEXT NOT NULL,
    updatedAt           TEXT NOT NULL,
    UNIQUE (
      sourceContentHash,
      sourceLanguage,
      targetLanguage,
      providerProfileId,
      providerModel,
      expertId,
      expertContentHash,
      promptVersion
    )
);

CREATE INDEX idx_translation_context_identity
  ON translation_context_cache(
    sourceContentHash,
    sourceLanguage,
    targetLanguage,
    providerProfileId,
    expertId
  );

ALTER TABLE translation_result ADD COLUMN expertId TEXT NOT NULL DEFAULT 'none';
ALTER TABLE translation_result ADD COLUMN expertContentHash TEXT NOT NULL DEFAULT 'none';
ALTER TABLE translation_result ADD COLUMN smartContextEnabled INTEGER NOT NULL DEFAULT 0
  CHECK (smartContextEnabled IN (0, 1));
ALTER TABLE translation_result ADD COLUMN contextPromptVersion TEXT NOT NULL DEFAULT 'none';
ALTER TABLE translation_result ADD COLUMN contextWarningCode TEXT;
ALTER TABLE translation_result ADD COLUMN contextWarningMessage TEXT;
ALTER TABLE translation_result ADD COLUMN contextWarningRetryable INTEGER;
`;
