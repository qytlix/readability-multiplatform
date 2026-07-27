import type Database from 'better-sqlite3';
import { normalizeSearchQuery } from '../../shared/search';

export const registerEntrySearchFunctions = (db: Database.Database): void => {
  db.function(
    'search_normalize',
    { deterministic: true },
    (value: unknown) => normalizeSearchQuery(typeof value === 'string' ? value : ''),
  );
};

export const MIGRATION_019 = `
CREATE VIRTUAL TABLE IF NOT EXISTS entry_search_fts USING fts5(
  title,
  markdown,
  feedId UNINDEXED,
  content = '',
  contentless_delete = 1,
  tokenize = 'trigram'
);

CREATE TRIGGER IF NOT EXISTS entry_search_entry_ai
AFTER INSERT ON entry
WHEN new.isDeleted = 0
BEGIN
  INSERT OR REPLACE INTO entry_search_fts(rowid, title, markdown, feedId)
  VALUES (
    new.id,
    search_normalize(COALESCE(new.title, '')),
    search_normalize(COALESCE((SELECT markdown FROM entry_content WHERE entryId = new.id), '')),
    new.feedId
  );
END;

CREATE TRIGGER IF NOT EXISTS entry_search_entry_au
AFTER UPDATE OF title, feedId, isDeleted ON entry
BEGIN
  DELETE FROM entry_search_fts WHERE rowid = old.id;
  INSERT OR REPLACE INTO entry_search_fts(rowid, title, markdown, feedId)
  SELECT
    new.id,
    search_normalize(COALESCE(new.title, '')),
    search_normalize(COALESCE((SELECT markdown FROM entry_content WHERE entryId = new.id), '')),
    new.feedId
  WHERE new.isDeleted = 0;
END;

CREATE TRIGGER IF NOT EXISTS entry_search_entry_ad
AFTER DELETE ON entry
BEGIN
  DELETE FROM entry_search_fts WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS entry_search_content_ai
AFTER INSERT ON entry_content
BEGIN
  INSERT OR REPLACE INTO entry_search_fts(rowid, title, markdown, feedId)
  SELECT
    entry.id,
    search_normalize(COALESCE(entry.title, '')),
    search_normalize(COALESCE(new.markdown, '')),
    entry.feedId
  FROM entry
  WHERE entry.id = new.entryId AND entry.isDeleted = 0;
END;

CREATE TRIGGER IF NOT EXISTS entry_search_content_au
AFTER UPDATE OF markdown ON entry_content
BEGIN
  INSERT OR REPLACE INTO entry_search_fts(rowid, title, markdown, feedId)
  SELECT
    entry.id,
    search_normalize(COALESCE(entry.title, '')),
    search_normalize(COALESCE(new.markdown, '')),
    entry.feedId
  FROM entry
  WHERE entry.id = new.entryId AND entry.isDeleted = 0;
END;

CREATE TRIGGER IF NOT EXISTS entry_search_content_ad
AFTER DELETE ON entry_content
BEGIN
  DELETE FROM entry_search_fts WHERE rowid = old.entryId;
  INSERT OR REPLACE INTO entry_search_fts(rowid, title, markdown, feedId)
  SELECT entry.id, search_normalize(COALESCE(entry.title, '')), '', entry.feedId
  FROM entry
  WHERE entry.id = old.entryId AND entry.isDeleted = 0;
END;
`;

export const rebuildEntrySearchIndex = (db: Database.Database): void => {
  db.prepare('DELETE FROM entry_search_fts').run();
  db.exec(`
    INSERT INTO entry_search_fts(rowid, title, markdown, feedId)
    SELECT
      entry.id,
      search_normalize(COALESCE(entry.title, '')),
      search_normalize(COALESCE(entry_content.markdown, '')),
      entry.feedId
    FROM entry
    LEFT JOIN entry_content ON entry_content.entryId = entry.id
    WHERE entry.isDeleted = 0
  `);
};
