/**
 * Migration 030: keep superseded Article Chat messages for usage/audit
 * identity while exposing only the current linear conversation branch.
 */
export const MIGRATION_030 = `
ALTER TABLE ai_chat_message ADD COLUMN supersededAt TEXT;

CREATE INDEX idx_ai_chat_message_thread_current
  ON ai_chat_message(threadId, createdAt, id)
  WHERE supersededAt IS NULL;
`;
