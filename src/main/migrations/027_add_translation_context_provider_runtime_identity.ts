/**
 * Migration 027: Scope smart-context cache rows to the effective Provider
 * runtime. Legacy rows deliberately retain NULL and therefore cannot match a
 * new identity.
 */
export const MIGRATION_027 = `
CREATE TABLE translation_context_cache_next (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    sourceContentHash       TEXT NOT NULL,
    sourceLanguage          TEXT NOT NULL CHECK (
      sourceLanguage IN ('auto', 'zh-CN', 'zh-HK', 'ja', 'ko', 'de', 'fr', 'es', 'en')
    ),
    targetLanguage          TEXT NOT NULL CHECK (
      targetLanguage IN ('zh-CN', 'zh-HK', 'ja', 'ko', 'de', 'fr', 'es', 'en')
    ),
    providerProfileId       INTEGER NOT NULL REFERENCES ai_provider_profile(id),
    providerModel           TEXT NOT NULL,
    providerRuntimeIdentity TEXT,
    expertId                TEXT NOT NULL,
    expertContentHash       TEXT NOT NULL,
    promptVersion           TEXT NOT NULL,
    contextJson             TEXT NOT NULL,
    createdAt               TEXT NOT NULL,
    updatedAt               TEXT NOT NULL,
    UNIQUE (
      sourceContentHash,
      sourceLanguage,
      targetLanguage,
      providerProfileId,
      providerModel,
      providerRuntimeIdentity,
      expertId,
      expertContentHash,
      promptVersion
    )
);

INSERT INTO translation_context_cache_next (
  id, sourceContentHash, sourceLanguage, targetLanguage, providerProfileId,
  providerModel, providerRuntimeIdentity, expertId, expertContentHash,
  promptVersion, contextJson, createdAt, updatedAt
)
SELECT
  id, sourceContentHash, sourceLanguage, targetLanguage, providerProfileId,
  providerModel, NULL, expertId, expertContentHash,
  promptVersion, contextJson, createdAt, updatedAt
FROM translation_context_cache;

DROP TABLE translation_context_cache;
ALTER TABLE translation_context_cache_next RENAME TO translation_context_cache;

CREATE INDEX idx_translation_context_identity
  ON translation_context_cache(
    sourceContentHash,
    sourceLanguage,
    targetLanguage,
    providerProfileId,
    providerRuntimeIdentity,
    expertId
  );
`;
