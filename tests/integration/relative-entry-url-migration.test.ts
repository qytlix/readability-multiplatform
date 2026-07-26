import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MIGRATION_001 } from '../../src/main/migrations/001_create_feeds';
import { MIGRATION_002 } from '../../src/main/migrations/002_create_entries';
import { runMigration016 } from '../../src/main/migrations/016_normalize_relative_entry_urls';

describe('migration 016 relative entry URLs', () => {
  it('repairs legacy relative article URLs without changing their GUIDs', () => {
    const database = new Database(':memory:');
    database.exec(MIGRATION_001);
    database.exec(MIGRATION_002);
    const timestamp = '2026-07-26T00:00:00.000Z';

    database.prepare(`
      INSERT INTO feed (id, title, feedURL, createdAt)
      VALUES (10, 'Paradigm X', 'https://soulhacker.me/index.xml', ?)
    `).run(timestamp);
    database.prepare(`
      INSERT INTO entry (
        id, feedId, guid, url, title, createdAt, updatedAt
      ) VALUES (
        285, 10, '/posts/good-code/', '/posts/good-code/',
        '什么是好的代码', ?, ?
      )
    `).run(timestamp, timestamp);

    runMigration016(database);
    runMigration016(database);

    expect(database.prepare(`
      SELECT guid, url, updatedAt FROM entry WHERE id = 285
    `).get()).toEqual({
      guid: '/posts/good-code/',
      url: 'https://soulhacker.me/posts/good-code/',
      updatedAt: timestamp,
    });
    database.close();
  });

  it('leaves absolute, malformed, and conflicting URLs untouched', () => {
    const database = new Database(':memory:');
    database.exec(MIGRATION_001);
    database.exec(MIGRATION_002);
    const timestamp = '2026-07-26T00:00:00.000Z';

    database.prepare(`
      INSERT INTO feed (id, feedURL, createdAt)
      VALUES (1, 'https://example.com/feed.xml', ?)
    `).run(timestamp);
    const insertEntry = database.prepare(`
      INSERT INTO entry (id, feedId, guid, url, createdAt, updatedAt)
      VALUES (?, 1, ?, ?, ?, ?)
    `);
    insertEntry.run(
      1,
      'absolute',
      'https://example.com/posts/absolute/',
      timestamp,
      timestamp,
    );
    insertEntry.run(2, 'malformed', 'http://[invalid', timestamp, timestamp);
    insertEntry.run(3, 'relative', '/posts/conflict/', timestamp, timestamp);
    insertEntry.run(
      4,
      'conflict',
      'https://example.com/posts/conflict/',
      timestamp,
      timestamp,
    );

    runMigration016(database);

    expect(database.prepare(`
      SELECT id, url FROM entry ORDER BY id
    `).all()).toEqual([
      { id: 1, url: 'https://example.com/posts/absolute/' },
      { id: 2, url: 'http://[invalid' },
      { id: 3, url: '/posts/conflict/' },
      { id: 4, url: 'https://example.com/posts/conflict/' },
    ]);
    database.close();
  });
});
