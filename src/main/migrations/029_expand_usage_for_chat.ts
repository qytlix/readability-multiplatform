/**
 * Migration 029: extend the usage ledger CHECK constraints for Article Chat
 * while preserving every existing Summary and Translation row.
 */
export const MIGRATION_029 = `
ALTER TABLE llm_usage_event RENAME TO llm_usage_event_legacy_029;

CREATE TABLE llm_usage_event (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    providerRequestId INTEGER NOT NULL UNIQUE,
    taskType          TEXT NOT NULL CHECK (
      taskType IN ('summary', 'translation', 'chat')
    ),
    taskRunId         INTEGER NOT NULL,
    providerProfileId INTEGER NOT NULL REFERENCES ai_provider_profile(id),
    model             TEXT NOT NULL,
    requestKind       TEXT NOT NULL CHECK (
      requestKind IN (
        'summary',
        'batch',
        'compensation',
        'chat-answer',
        'chat-history-compression',
        'chat-segment-analysis',
        'chat-article-map'
      )
    ),
    requestStatus     TEXT NOT NULL CHECK (
      requestStatus IN ('running', 'succeeded', 'failed', 'interrupted')
    ),
    errorCode         TEXT,
    inputTokens       INTEGER CHECK (inputTokens IS NULL OR inputTokens >= 0),
    outputTokens      INTEGER CHECK (outputTokens IS NULL OR outputTokens >= 0),
    totalTokens       INTEGER CHECK (totalTokens IS NULL OR totalTokens >= 0),
    usageAvailability TEXT NOT NULL CHECK (
      usageAvailability IN ('reported', 'partial', 'missing')
    ),
    startedAt         TEXT NOT NULL,
    finishedAt        TEXT,
    attemptId         TEXT
);

INSERT INTO llm_usage_event
  (id, providerRequestId, taskType, taskRunId, providerProfileId, model,
   requestKind, requestStatus, errorCode, inputTokens, outputTokens,
   totalTokens, usageAvailability, startedAt, finishedAt, attemptId)
SELECT
  id, providerRequestId, taskType, taskRunId, providerProfileId, model,
  requestKind, requestStatus, errorCode, inputTokens, outputTokens,
  totalTokens, usageAvailability, startedAt, finishedAt, attemptId
FROM llm_usage_event_legacy_029;

DROP TABLE llm_usage_event_legacy_029;

CREATE INDEX idx_llm_usage_event_started
  ON llm_usage_event(startedAt DESC);
CREATE INDEX idx_llm_usage_event_task_started
  ON llm_usage_event(taskType, taskRunId, startedAt DESC);
CREATE INDEX idx_llm_usage_event_model_started
  ON llm_usage_event(providerProfileId, model, startedAt DESC);
CREATE INDEX idx_llm_usage_event_status_started
  ON llm_usage_event(requestStatus, startedAt DESC);
`;
