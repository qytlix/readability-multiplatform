import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATION_001 } from '../../src/main/migrations/001_create_feeds';
import { MIGRATION_002 } from '../../src/main/migrations/002_create_entries';
import { MIGRATION_003 } from '../../src/main/migrations/003_create_contents';
import {
  MIGRATION_019,
  rebuildEntrySearchIndex,
  registerEntrySearchFunctions,
} from '../../src/main/migrations/019_create_entry_search_index';

describe('entry search index migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    registerEntrySearchFunctions(db);
    db.exec(MIGRATION_001);
    db.exec(MIGRATION_002);
    db.exec(MIGRATION_003);

    const now = '2026-07-27T00:00:00.000Z';
    db.prepare(`
      INSERT INTO feed (title, feedURL, createdAt)
      VALUES ('Legacy Feed', 'https://legacy.example/feed', ?)
    `).run(now);
    db.prepare(`
      INSERT INTO entry (
        feedId, guid, title, publishedAt, createdAt, updatedAt
      ) VALUES (1, 'legacy-entry', 'Legacy migration title', ?, ?, ?)
    `).run(now, now, now);
    db.prepare(`
      INSERT INTO entry_content (
        entryId, markdown, pipelineStatus, createdAt, updatedAt
      ) VALUES (1, 'Persisted searchable body', 'success', ?, ?)
    `).run(now, now);
  });

  afterEach(() => {
    db.close();
  });

  const matchingIds = (query: string): number[] => (
    db.prepare(`
      SELECT rowid AS id
      FROM entry_search_fts
      WHERE entry_search_fts MATCH ?
      ORDER BY rowid
    `).all(`"${query}"`) as Array<{ id: number }>
  ).map(({ id }) => id);

  it('backfills existing titles and cleaned markdown', () => {
    db.exec(MIGRATION_019);
    rebuildEntrySearchIndex(db);

    expect(matchingIds('Legacy')).toEqual([1]);
    expect(matchingIds('searchable')).toEqual([1]);
  });

  it('keeps title, markdown, soft deletion and hard deletion in sync', () => {
    db.exec(MIGRATION_019);
    rebuildEntrySearchIndex(db);

    db.prepare("UPDATE entry SET title = 'Updated indexed title' WHERE id = 1").run();
    expect(matchingIds('Legacy')).toEqual([]);
    expect(matchingIds('Updated')).toEqual([1]);

    db.prepare(`
      UPDATE entry_content
      SET markdown = 'Replacement indexed body'
      WHERE entryId = 1
    `).run();
    expect(matchingIds('searchable')).toEqual([]);
    expect(matchingIds('Replacement')).toEqual([1]);

    db.prepare('UPDATE entry SET isDeleted = 1 WHERE id = 1').run();
    expect(matchingIds('Updated')).toEqual([]);

    db.prepare('UPDATE entry SET isDeleted = 0 WHERE id = 1').run();
    expect(matchingIds('Updated')).toEqual([1]);

    db.prepare('DELETE FROM feed WHERE id = 1').run();
    expect(matchingIds('Updated')).toEqual([]);
  });
});
