import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MIGRATION_001 } from '../../src/main/migrations/001_create_feeds';
import { MIGRATION_002 } from '../../src/main/migrations/002_create_entries';
import { runMigration017 } from '../../src/main/migrations/017_normalize_entry_summaries';

describe('migration 017 entry summaries', () => {
  it('repairs legacy HTML summaries without changing entry timestamps', () => {
    const database = new Database(':memory:');
    database.exec(MIGRATION_001);
    database.exec(MIGRATION_002);
    const timestamp = '2026-07-26T00:00:00.000Z';

    database.prepare(`
      INSERT INTO feed (id, feedURL, createdAt)
      VALUES (1, 'https://example.com/feed.xml', ?)
    `).run(timestamp);
    database.prepare(`
      INSERT INTO entry (
        id, feedId, guid, summary, createdAt, updatedAt
      ) VALUES (
        1, 1, 'ruff-v0.16.0',
        '<p><strong><a href="https://astral.sh/blog/ruff-v0.16.0">Ruff v0.16.0</a></strong></p> Astral shipped a significant release &amp; more.',
        ?, ?
      )
    `).run(timestamp, timestamp);

    runMigration017(database);
    runMigration017(database);

    expect(database.prepare(`
      SELECT summary, updatedAt FROM entry WHERE id = 1
    `).get()).toEqual({
      summary: 'Ruff v0.16.0 Astral shipped a significant release & more.',
      updatedAt: timestamp,
    });
    database.close();
  });

  it('keeps plain text and removes non-content markup', () => {
    const database = new Database(':memory:');
    database.exec(MIGRATION_001);
    database.exec(MIGRATION_002);
    const timestamp = '2026-07-26T00:00:00.000Z';

    database.prepare(`
      INSERT INTO feed (id, feedURL, createdAt)
      VALUES (1, 'https://example.com/feed.xml', ?)
    `).run(timestamp);
    const insertEntry = database.prepare(`
      INSERT INTO entry (
        id, feedId, guid, summary, createdAt, updatedAt
      ) VALUES (?, 1, ?, ?, ?, ?)
    `);
    insertEntry.run(1, 'plain', 'Already readable.', timestamp, timestamp);
    insertEntry.run(
      2,
      'markup',
      '<style>.hidden { display: none; }</style><script>secret()</script><p>Visible text.</p>',
      timestamp,
      timestamp,
    );

    runMigration017(database);

    expect(database.prepare(`
      SELECT id, summary FROM entry ORDER BY id
    `).all()).toEqual([
      { id: 1, summary: 'Already readable.' },
      { id: 2, summary: 'Visible text.' },
    ]);
    database.close();
  });
});
