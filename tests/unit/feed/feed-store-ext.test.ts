import { describe, it, expect, beforeEach } from 'vitest';
import { FeedStore } from '../../../src/main/feed/stores/FeedStore';
import { buildTestDb } from '../../fixtures/databases/feed-fixture';

describe('FeedStore (M2 extensions)', () => {
  let feedStore: FeedStore;
  let db: ReturnType<typeof buildTestDb>['db'];

  beforeEach(() => {
    const testDb = buildTestDb();
    db = testDb.db;
    feedStore = new FeedStore(db);
  });

  describe('findByDedupKey', () => {
    it('should find a feed by its dedupKey', () => {
      feedStore.create({ title: 'Test', feedURL: 'https://xkcd.com/feed.xml' });

      const found = feedStore.findByDedupKey('https://xkcd.com/feed.xml');
      expect(found).toBeDefined();
      expect(found!.title).toBe('Test');
    });

    it('should find a feed with case-different host', () => {
      feedStore.create({ title: 'Test', feedURL: 'https://XKCD.COM/feed.xml' });

      // dedupKey is normalized to lowercase host
      const found = feedStore.findByDedupKey('https://xkcd.com/feed.xml');
      expect(found).toBeDefined();
      expect(found!.title).toBe('Test');
    });

    it('should return undefined for non-existent dedupKey', () => {
      feedStore.create({ title: 'Test', feedURL: 'https://xkcd.com/feed.xml' });

      const found = feedStore.findByDedupKey('https://other.com/feed.xml');
      expect(found).toBeUndefined();
    });
  });

  describe('create with dedupKey', () => {
    it('should auto-compute dedupKey on create', () => {
      feedStore.create({ feedURL: 'https://XKCD.COM/Feed/' });

      // findByDedupKey should work with normalized version
      const found = feedStore.findByDedupKey('https://xkcd.com/Feed');
      expect(found).toBeDefined();
      expect(found!.feedURL).toBe('https://XKCD.COM/Feed/');
    });
  });

  describe('deleteAllExcept', () => {
    it('should delete feeds not in the keep set', () => {
      feedStore.create({ title: 'Keep A', feedURL: 'https://a.example.com/feed.xml' });
      feedStore.create({ title: 'Keep B', feedURL: 'https://b.example.com/feed.xml' });
      feedStore.create({ title: 'Delete C', feedURL: 'https://c.example.com/feed.xml' });
      feedStore.create({ title: 'Delete D', feedURL: 'https://d.example.com/feed.xml' });

      const keepKeys = new Set([
        'https://a.example.com/feed.xml',
        'https://b.example.com/feed.xml',
      ]);

      const deleted = feedStore.deleteAllExcept(keepKeys);
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

    it('should keep all feeds when all dedupKeys are in keep set', () => {
      feedStore.create({ title: 'A', feedURL: 'https://a.example.com/feed.xml' });
      feedStore.create({ title: 'B', feedURL: 'https://b.example.com/feed.xml' });

      const keepKeys = new Set([
        'https://a.example.com/feed.xml',
        'https://b.example.com/feed.xml',
      ]);

      const deleted = feedStore.deleteAllExcept(keepKeys);
      expect(deleted).toBe(0);
      expect(feedStore.findAll()).toHaveLength(2);
    });

    it('should be case-insensitive for host via dedupKey normalization', () => {
      feedStore.create({ title: 'A', feedURL: 'https://Example.com/Feed.xml' });

      // Pass the same normalized dedupKey as the feed would produce
      const keepKeys = new Set(['https://example.com/Feed.xml']);
      const deleted = feedStore.deleteAllExcept(keepKeys);
      expect(deleted).toBe(0);
      expect(feedStore.findAll()).toHaveLength(1);
    });

    it('should match feeds with trailing slash difference', () => {
      feedStore.create({ title: 'A', feedURL: 'https://example.com/feed/' });

      const keepKeys = new Set(['https://example.com/feed']);
      const deleted = feedStore.deleteAllExcept(keepKeys);
      expect(deleted).toBe(0);
      expect(feedStore.findAll()).toHaveLength(1);
    });
  });
});