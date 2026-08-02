/**
 * Migration 027: persist Article Chat threads, messages, runs, and attachment
 * metadata. Attachment bytes remain outside SQLite.
 */
export const MIGRATION_027 = `
CREATE TABLE IF NOT EXISTS ai_chat_thread (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    entryId              INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
    sourceContentHash    TEXT NOT NULL,
    contextPromptVersion TEXT NOT NULL,
    active               INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    createdAt            TEXT NOT NULL,
    updatedAt            TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_chat_thread_active_content
  ON ai_chat_thread(entryId, sourceContentHash)
  WHERE active = 1;

CREATE INDEX IF NOT EXISTS idx_ai_chat_thread_entry_updated
  ON ai_chat_thread(entryId, updatedAt DESC);

CREATE TABLE IF NOT EXISTS ai_chat_message (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    threadId             INTEGER NOT NULL REFERENCES ai_chat_thread(id) ON DELETE CASCADE,
    role                 TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content              TEXT NOT NULL,
    status               TEXT NOT NULL CHECK (
      status IN ('running', 'completed', 'failed', 'interrupted')
    ),
    selectedText         TEXT,
    selectedContext      TEXT,
    articleContextMode   TEXT NOT NULL CHECK (
      articleContextMode IN ('full', 'history-compressed', 'article-map')
    ),
    articleContentHash   TEXT NOT NULL,
    createdAt            TEXT NOT NULL,
    updatedAt            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_message_thread_created
  ON ai_chat_message(threadId, createdAt, id);

CREATE TABLE IF NOT EXISTS ai_chat_run (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    threadId             INTEGER NOT NULL REFERENCES ai_chat_thread(id) ON DELETE CASCADE,
    userMessageId        INTEGER NOT NULL REFERENCES ai_chat_message(id) ON DELETE CASCADE,
    assistantMessageId   INTEGER NOT NULL REFERENCES ai_chat_message(id) ON DELETE CASCADE,
    providerProfileId    INTEGER NOT NULL REFERENCES ai_provider_profile(id),
    providerKind         TEXT NOT NULL,
    model                TEXT NOT NULL,
    status               TEXT NOT NULL CHECK (
      status IN ('running', 'succeeded', 'failed', 'interrupted')
    ),
    promptVersion        TEXT NOT NULL,
    contextMode          TEXT NOT NULL CHECK (
      contextMode IN ('full', 'history-compressed', 'article-map')
    ),
    inputContentHash     TEXT NOT NULL,
    errorCode            TEXT,
    errorMessage         TEXT,
    errorRetryable       INTEGER,
    createdAt            TEXT NOT NULL,
    completedAt          TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_chat_run_user_message
  ON ai_chat_run(userMessageId);

CREATE INDEX IF NOT EXISTS idx_ai_chat_run_thread_created
  ON ai_chat_run(threadId, createdAt DESC);

CREATE TABLE IF NOT EXISTS ai_chat_attachment (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    threadId             INTEGER NOT NULL REFERENCES ai_chat_thread(id) ON DELETE CASCADE,
    kind                 TEXT NOT NULL CHECK (kind IN ('text', 'image')),
    displayName          TEXT NOT NULL,
    mimeType             TEXT NOT NULL,
    byteSize             INTEGER NOT NULL CHECK (byteSize >= 0),
    textContent          TEXT,
    contentHash          TEXT NOT NULL,
    storageKey           TEXT,
    width                INTEGER CHECK (width IS NULL OR width > 0),
    height               INTEGER CHECK (height IS NULL OR height > 0),
    expiresAt            TEXT,
    createdAt            TEXT NOT NULL,
    CHECK (
      (kind = 'text' AND textContent IS NOT NULL AND storageKey IS NULL)
      OR
      (kind = 'image' AND textContent IS NULL AND storageKey IS NOT NULL
       AND width IS NOT NULL AND height IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_attachment_thread
  ON ai_chat_attachment(threadId, createdAt);

CREATE INDEX IF NOT EXISTS idx_ai_chat_attachment_expiry
  ON ai_chat_attachment(expiresAt)
  WHERE expiresAt IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_chat_message_attachment (
    messageId            INTEGER NOT NULL REFERENCES ai_chat_message(id) ON DELETE CASCADE,
    attachmentId         INTEGER NOT NULL REFERENCES ai_chat_attachment(id) ON DELETE RESTRICT,
    orderIndex           INTEGER NOT NULL CHECK (orderIndex >= 0),
    PRIMARY KEY (messageId, attachmentId),
    UNIQUE (messageId, orderIndex)
);
`;
