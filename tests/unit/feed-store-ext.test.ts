import { describe, it, expect, beforeEach } from 'vitest';
import { FeedStore } from '../../src/main/feed/FeedStore';
import { buildTestDb } from '../fixtures/databases/feed-fixture';

describe('FeedStore (M2 extensions)', () => {
  let feedStore: FeedStore;
  let db: ReturnType<typeof buildTestDb>['db'];

  beforeEach(() => {
    const testDb = buildTestDb();
    db = testDb.db;
    feedStore = new FeedStore(db);
  });

  describe('deleteAllExcept', () => {
    it('should delete feeds not in the keep set', () => {
      feedStore.create({ title: 'Keep A', feedURL: 'https://a.example.com/feed.xml' });
      feedStore.create({ title: 'Keep B', feedURL: 'https://b.example.com/feed.xml' });
      feedStore.create({ title: 'Delete C', feedURL: 'https://c.example.com/feed.xml' });
      feedStore.create({ title: 'Delete D', feedURL: 'https://d.example.com/feed.xml' });

      const keepUrls = new Set([
        'https://a.example.com/feed.xml',
        'https://b.example.com/feed.xml',
      ]);

      const deleted = feedStore.deleteAllExcept(keepUrls);
      expect(deleted).toBe(2);

      const remaining = feedStore.findAll();
      expect(remaining).toHaveLength(2);
      expect(remaining.map((f) => f.title)).toEqual(['Keep A', 'Keep B']);
    });

    it('should handle empty keep set by deleting all', () => {
      feedStore.create({ title: 'A', feedURL: 'https://a.example.com/feed.xml' });
      feedStore.create({ title: 'B', feedURL: 'https://b.example.com/feed.xml' });

      const deleted = feedStore.deleteAllExcept(new Set());
      expect(deleted).toBe(2);
      expect(feedStore.findAll()).toHaveLength(0);
    });

    it('should keep all feeds when all URLs are in keep set', () => {
      feedStore.create({ title: 'A', feedURL: 'https://a.example.com/feed.xml' });
      feedStore.create({ title: 'B', feedURL: 'https://b.example.com/feed.xml' });

      const keepUrls = new Set([
        'https://a.example.com/feed.xml',
        'https://b.example.com/feed.xml',
      ]);

      const deleted = feedStore.deleteAllExcept(keepUrls);
      expect(deleted).toBe(0);
      expect(feedStore.findAll()).toHaveLength(2);
    });

    it('should be case-insensitive in matching URLs', () => {
      feedStore.create({ title: 'A', feedURL: 'https://Example.com/Feed.xml' });

      const keepUrls = new Set(['https://example.com/feed.xml']);
      const deleted = feedStore.deleteAllExcept(keepUrls);
      expect(deleted).toBe(0);
      expect(feedStore.findAll()).toHaveLength(1);
    });
  });
});