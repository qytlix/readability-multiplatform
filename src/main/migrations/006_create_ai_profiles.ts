/** Migration 006: Create redacted AI provider profile storage. */
export const MIGRATION_006 = `
CREATE TABLE IF NOT EXISTS ai_provider_profile (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    providerKind TEXT NOT NULL CHECK (providerKind = 'openai-compatible'),
    baseUrl      TEXT NOT NULL,
    model        TEXT NOT NULL,
    apiKeyRef    TEXT NOT NULL UNIQUE,
    isActive     INTEGER NOT NULL DEFAULT 1 CHECK (isActive IN (0, 1)),
    createdAt    TEXT NOT NULL,
    updatedAt    TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_provider_profile_active
  ON ai_provider_profile(isActive)
  WHERE isActive = 1;
`;
