/** Migration 011: Persist one local usage ledger row per Provider request. */
export const MIGRATION_011 = `
CREATE TABLE IF NOT EXISTS llm_usage_event (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    providerRequestId INTEGER NOT NULL UNIQUE,
    taskType          TEXT NOT NULL CHECK (taskType IN ('summary', 'translation')),
    taskRunId         INTEGER NOT NULL,
    providerProfileId INTEGER NOT NULL REFERENCES ai_provider_profile(id),
    model             TEXT NOT NULL,
    requestKind       TEXT NOT NULL CHECK (requestKind IN ('summary', 'batch', 'compensation')),
    requestStatus     TEXT NOT NULL CHECK (requestStatus IN ('running', 'succeeded', 'failed', 'interrupted')),
    errorCode         TEXT,
    inputTokens       INTEGER CHECK (inputTokens IS NULL OR inputTokens >= 0),
    outputTokens      INTEGER CHECK (outputTokens IS NULL OR outputTokens >= 0),
    totalTokens       INTEGER CHECK (totalTokens IS NULL OR totalTokens >= 0),
    usageAvailability TEXT NOT NULL CHECK (usageAvailability IN ('reported', 'partial', 'missing')),
    startedAt         TEXT NOT NULL,
    finishedAt        TEXT
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_event_started
  ON llm_usage_event(startedAt DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_event_task_started
  ON llm_usage_event(taskType, taskRunId, startedAt DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_event_model_started
  ON llm_usage_event(providerProfileId, model, startedAt DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_event_status_started
  ON llm_usage_event(requestStatus, startedAt DESC);
`;
