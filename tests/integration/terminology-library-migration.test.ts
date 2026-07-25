import { describe, expect, it } from 'vitest';
import { DatabaseManager } from '../../src/main/database/DatabaseManager';

describe('migration 015 terminology libraries', () => {
  it('creates user library, entry, and persistent config tables', () => {
    const manager = new DatabaseManager();
    try {
      manager.runMigrations();
      const tables = manager.getDb().prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'terminology_%'
        ORDER BY name
      `).all();
      expect(tables).toEqual([
        { name: 'terminology_entry_user' },
        { name: 'terminology_library_config' },
        { name: 'terminology_library_user' },
      ]);
      expect(manager.getDb().prepare(`
        SELECT filename FROM _migrations
        WHERE filename = '015_add_terminology_libraries'
      `).get()).toEqual({
        filename: '015_add_terminology_libraries',
      });
    } finally {
      manager.close();
    }
  });
});
