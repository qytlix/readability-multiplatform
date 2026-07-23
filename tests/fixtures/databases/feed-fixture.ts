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
  db.prepare('UPDATE entry SET readingProgress = 1 WHERE isRead = 1').run();

  return { dbManager, db };
}

/**
 * Build a test database pre-populated with feed, entries, and entry_content.
 * Entry 3 intentionally has no entry_content row (simulates un-cleaned entry).
 */
export function buildTestDbWithContent() {
  const { dbManager, db } = buildTestDbWithData();
  const now = new Date().toISOString();

  const insertContent = db.prepare(`
    INSERT INTO entry_content (entryId, html, cleanedHtml, markdown, pipelineStatus, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertContent.run(1, '<html>1</html>', '<p>cleaned one</p>', 'markdown body for first post', 'success', now, now);
  insertContent.run(2, '<html>2</html>', '<p>cleaned two</p>', 'markdown body for second article', 'success', now, now);
  // entry 3 intentionally left without entry_content

  // Entry 4: special LIKE characters in title and summary
  db.prepare(`
    INSERT INTO entry (feedId, guid, url, title, author, publishedAt, summary, isRead, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(1, 'guid-4', 'https://example.com/post-4', '100% completion rate', 'Author C', '2026-07-11T10:00:00Z', 'test_data format', 0, now, now);
  insertContent.run(4, '<html>4</html>', '<p>cleaned four</p>', 'markdown with backslash test and 50% off', 'success', now, now);

  return { dbManager, db };
}
