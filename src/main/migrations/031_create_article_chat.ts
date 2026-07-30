/** Migration 031: 持久化按文章内容版本隔离的问答会话。 */
export const MIGRATION_031 = `
CREATE TABLE IF NOT EXISTS ai_chat_thread (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    entryId           INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
    sourceContentHash TEXT NOT NULL,
    promptVersion     TEXT NOT NULL,
    createdAt         TEXT NOT NULL,
    updatedAt         TEXT NOT NULL,
    UNIQUE(entryId, sourceContentHash, promptVersion)
);

CREATE TABLE IF NOT EXISTS ai_chat_message (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    threadId  INTEGER NOT NULL REFERENCES ai_chat_thread(id) ON DELETE CASCADE,
    role      TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content   TEXT NOT NULL,
    status    TEXT NOT NULL CHECK (
      status IN ('succeeded', 'streaming', 'failed', 'interrupted')
    ),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_message_thread
  ON ai_chat_message(threadId, id);

CREATE TABLE IF NOT EXISTS ai_chat_run (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    threadId           INTEGER NOT NULL REFERENCES ai_chat_thread(id) ON DELETE CASCADE,
    userMessageId      INTEGER NOT NULL REFERENCES ai_chat_message(id) ON DELETE CASCADE,
    assistantMessageId INTEGER NOT NULL REFERENCES ai_chat_message(id) ON DELETE CASCADE,
    providerProfileId  INTEGER NOT NULL REFERENCES ai_provider_profile(id),
    status             TEXT NOT NULL CHECK (
      status IN ('running', 'succeeded', 'failed', 'interrupted')
    ),
    errorCode          TEXT,
    errorMessage       TEXT,
    errorRetryable     INTEGER,
    createdAt          TEXT NOT NULL,
    completedAt        TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_run_thread
  ON ai_chat_run(threadId, id DESC);
`;
