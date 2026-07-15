import Database from 'better-sqlite3';
import { DatabaseManager } from '../../../src/main/database/DatabaseManager';

/**
 * Build an in-memory database with all migrations applied.
 * Returns the DatabaseManager, db instance, and helper store instances.
 */
export function buildTestDb() {
  const dbManager = new DatabaseManager(':memory:');
  dbManager.runMigrations();
  const db = dbManager.getDb();

  return { dbManager, db };
}

/**
 * Create a test database pre-populated with a feed and entries.
 */
export function buildTestDbWithData() {
  const { dbManager, db } = buildTestDb();
  const now = new Date().toISOString();

  // Insert a test feed
  db.prepare(`
    INSERT INTO feed (title, feedURL, siteURL, lastSyncStatus, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `).run('Test Feed', 'https://example.com/feed.xml', 'https://example.com', 'success', now);

  // Insert test entries
  const insertEntry = db.prepare(`
    INSERT INTO entry (feedId, guid, url, title, author, publishedAt, summary, isRead, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertEntry.run(1, 'guid-1', 'https://example.com/post-1', 'First Post', 'Author A', '2026-07-14T10:00:00Z', 'First summary', 0, now, now);
  insertEntry.run(1, 'guid-2', 'https://example.com/post-2', 'Second Post', 'Author B', '2026-07-13T10:00:00Z', 'Second summary', 0, now, now);
  insertEntry.run(1, 'guid-3', 'https://example.com/post-3', 'Third Post', 'Author A', '2026-07-12T10:00:00Z', 'Third summary', 1, now, now);

  return { dbManager, db };
}