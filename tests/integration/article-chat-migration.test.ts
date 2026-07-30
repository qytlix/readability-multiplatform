import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { DatabaseManager } from '../../src/main/database/DatabaseManager';

describe('article chat migration 027', () => {
  it('creates the chat graph after the existing migration chain', () => {
    const manager = new DatabaseManager();
    try {
      manager.runMigrations();
      const db = manager.getDb();
      const tables = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'ai_chat_%'
        ORDER BY name
      `).all() as Array<{ name: string }>;

      expect(tables.map(({ name }) => name)).toEqual([
        'ai_chat_attachment',
        'ai_chat_message',
        'ai_chat_message_attachment',
        'ai_chat_run',
        'ai_chat_thread',
      ]);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      manager.close();
    }
  });

  it('allows only one active thread for an article content hash', () => {
    const manager = new DatabaseManager();
    try {
      manager.runMigrations();
      const db = manager.getDb();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO feed (id, feedURL, title, createdAt)
        VALUES (1, 'https://example.test/feed', 'Example', ?)
      `).run(now);
      db.prepare(`
        INSERT INTO entry
          (id, feedId, guid, url, title, isRead, isStarred, createdAt, updatedAt)
        VALUES (1, 1, 'entry-1', 'https://example.test/1', 'Entry', 0, 0, ?, ?)
      `).run(now, now);
      const insert = db.prepare(`
        INSERT INTO ai_chat_thread
          (entryId, sourceContentHash, contextPromptVersion, active, createdAt, updatedAt)
        VALUES (1, 'hash-a', 'article-chat-v1', ?, ?, ?)
      `);
      insert.run(1, now, now);
      expect(() => insert.run(1, now, now)).toThrow();
      expect(() => insert.run(0, now, now)).not.toThrow();
      expect(() => insert.run(0, now, now)).not.toThrow();
    } finally {
      manager.close();
    }
  });

  it('rejects an image attachment without safe storage metadata', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const manager = new DatabaseManager();
    try {
      manager.runMigrations();
      const migratedDb = manager.getDb();
      const attachmentSql = migratedDb.prepare(`
        SELECT sql FROM sqlite_master
        WHERE type = 'table' AND name = 'ai_chat_attachment'
      `).get() as { sql: string };
      expect(attachmentSql.sql).toContain("kind = 'image'");
      expect(attachmentSql.sql).toContain('storageKey IS NOT NULL');
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
      manager.close();
    }
  });
});
