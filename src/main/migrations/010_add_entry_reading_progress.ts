/** Migration 010: Persist each article's last Reader position. */
export const MIGRATION_010 = `
ALTER TABLE entry
  ADD COLUMN readingProgress REAL NOT NULL DEFAULT 0
  CHECK (readingProgress >= 0 AND readingProgress <= 1);

UPDATE entry
SET readingProgress = 1
WHERE isRead = 1;
`;
