/** Migration 007: Persist Summary runs and final results. */
export const MIGRATION_007 = `
CREATE TABLE IF NOT EXISTS agent_task_run (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    entryId           INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
    taskType          TEXT NOT NULL CHECK (taskType = 'summary'),
    providerProfileId INTEGER NOT NULL REFERENCES ai_provider_profile(id),
    targetLanguage    TEXT NOT NULL CHECK (targetLanguage IN ('zh-CN', 'en')),
    detailLevel       TEXT NOT NULL CHECK (detailLevel IN ('short', 'medium', 'detailed')),
    inputMarkdownHash TEXT NOT NULL,
    status            TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    errorCode         TEXT,
    errorMessage      TEXT,
    errorRetryable    INTEGER,
    createdAt         TEXT NOT NULL,
    completedAt       TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_task_run_slot
  ON agent_task_run(entryId, targetLanguage, detailLevel, createdAt DESC);

CREATE TABLE IF NOT EXISTS summary_result (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    runId             INTEGER NOT NULL UNIQUE REFERENCES agent_task_run(id) ON DELETE CASCADE,
    entryId           INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
    targetLanguage    TEXT NOT NULL CHECK (targetLanguage IN ('zh-CN', 'en')),
    detailLevel       TEXT NOT NULL CHECK (detailLevel IN ('short', 'medium', 'detailed')),
    inputMarkdownHash TEXT NOT NULL,
    promptVersion     TEXT NOT NULL,
    content           TEXT NOT NULL,
    createdAt         TEXT NOT NULL,
    updatedAt         TEXT NOT NULL,
    UNIQUE(entryId, targetLanguage, detailLevel)
);
`;
