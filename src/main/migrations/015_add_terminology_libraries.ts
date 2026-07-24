/** Migration 015: enabled terminology libraries and transactional user CSV data. */
export const MIGRATION_015 = `
  CREATE TABLE terminology_library_config (
    libraryId  TEXT PRIMARY KEY,
    enabled    INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    orderIndex INTEGER NOT NULL,
    updatedAt  TEXT NOT NULL
  );

  CREATE TABLE terminology_library_user (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL COLLATE NOCASE UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    author      TEXT NOT NULL DEFAULT 'User',
    version     TEXT NOT NULL,
    contentHash TEXT NOT NULL,
    entryCount  INTEGER NOT NULL CHECK (entryCount >= 0),
    createdAt   TEXT NOT NULL,
    updatedAt   TEXT NOT NULL
  );

  CREATE TABLE terminology_entry_user (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    libraryId      TEXT NOT NULL
      REFERENCES terminology_library_user(id) ON DELETE CASCADE,
    source         TEXT NOT NULL,
    normalizedSource TEXT NOT NULL,
    target         TEXT,
    targetLanguage TEXT CHECK (
      targetLanguage IS NULL OR targetLanguage IN (
        'zh-CN', 'zh-HK', 'ja', 'ko', 'de', 'fr', 'es', 'en'
      )
    ),
    sourceLine     INTEGER NOT NULL CHECK (sourceLine >= 2)
  );

  CREATE INDEX idx_terminology_entry_user_lookup
    ON terminology_entry_user(normalizedSource, targetLanguage, libraryId);
`;
