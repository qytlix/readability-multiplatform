/** Migration 011: Persist text-range highlights and their optional notes. */
export const MIGRATION_011 = `
CREATE TABLE IF NOT EXISTS entry_annotation (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entryId      INTEGER NOT NULL,
  startOffset  INTEGER NOT NULL CHECK (startOffset >= 0),
  endOffset    INTEGER NOT NULL CHECK (endOffset > startOffset),
  selectedText TEXT NOT NULL CHECK (length(selectedText) > 0),
  prefixText   TEXT NOT NULL DEFAULT '',
  suffixText   TEXT NOT NULL DEFAULT '',
  color        TEXT NOT NULL CHECK (color IN ('yellow', 'green', 'blue', 'pink')),
  noteText     TEXT NOT NULL DEFAULT '',
  createdAt    TEXT NOT NULL,
  updatedAt    TEXT NOT NULL,
  FOREIGN KEY (entryId) REFERENCES entry(id) ON DELETE CASCADE,
  UNIQUE (entryId, startOffset, endOffset)
);

CREATE INDEX IF NOT EXISTS idx_entry_annotation_entry
  ON entry_annotation(entryId, startOffset, endOffset);
`;
