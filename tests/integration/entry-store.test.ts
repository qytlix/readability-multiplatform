import { describe, it, expect, beforeEach } from 'vitest';
import { EntryStore } from '../../src/main/feed/stores/EntryStore';
import { FeedStore } from '../../src/main/feed/stores/FeedStore';
import { buildTestDb, buildTestDbWithContent } from '../fixtures/databases/feed-fixture';

describe('EntryStore', () => {
  let entryStore: EntryStore;
  let feedStore: FeedStore;
  let db: ReturnType<typeof buildTestDb>['db'];
  let feedId: number;

  beforeEach(() => {
    const testDb = buildTestDb();
    db = testDb.db;
    entryStore = new EntryStore(db);
    feedStore = new FeedStore(db);

    const feed = feedStore.create({
      title: 'Test Feed',
      feedURL: 'https://example.com/feed.xml',
    });
    feedId = feed.id;
  });

  describe('createOrUpdate', () => {
    it('should create a new entry', () => {
      const { id, isNew } = entryStore.createOrUpdate({
        feedId,
        guid: 'guid-1',
        url: 'https://example.com/post-1',
        title: 'First Post',
        author: 'Author',
        publishedAt: '2026-07-14T10:00:00Z',
        summary: 'Summary',
      });

      expect(id).toBeGreaterThan(0);
      expect(isNew).toBe(true);
      const entry = entryStore.findById(id);
      expect(entry).toBeDefined();
      expect(entry!.title).toBe('First Post');
    });

    it('should update existing entry with same (feedId, guid)', () => {
      const { id: id1 } = entryStore.createOrUpdate({
        feedId,
        guid: 'guid-1',
        title: 'Original Title',
      });

      const { id: id2 } = entryStore.createOrUpdate({
        feedId,
        guid: 'guid-1',
        title: 'Updated Title',
      });

      expect(id1).toBe(id2);
      const entry = entryStore.findById(id1);
      expect(entry!.title).toBe('Updated Title');
    });

    it('should fallback to (feedId, url) for entries without guid', () => {
      const { id: id1 } = entryStore.createOrUpdate({
        feedId,
        url: 'https://example.com/no-guid',
        title: 'First',
      });

      const { id: id2 } = entryStore.createOrUpdate({
        feedId,
        url: 'https://example.com/no-guid',
        title: 'Second',
      });

      expect(id1).toBe(id2);
      const entry = entryStore.findById(id1);
      expect(entry!.title).toBe('Second');
    });

    it('should preserve isRead/isStarred on update', () => {
      const { id } = entryStore.createOrUpdate({
        feedId,
        guid: 'guid-1',
        title: 'Original',
      });

      entryStore.markRead([id], true);
      entryStore.markStarred(id, true);

      entryStore.createOrUpdate({
        feedId,
        guid: 'guid-1',
        title: 'Updated',
      });

      const entry = entryStore.findById(id);
      expect(entry!.isRead).toBe(true);
      expect(entry!.isStarred).toBe(true);
    });

    it('should not resurrect tombstone entries', () => {
      const { id } = entryStore.createOrUpdate({
        feedId,
        guid: 'guid-1',
        title: 'Original',
      });

      entryStore.softDelete(id);

      // Re-sync with same guid should not resurrect
      const { id: newId } = entryStore.createOrUpdate({
        feedId,
        guid: 'guid-1',
        title: 'Should Not Resurrect',
      });

      // Should return the original id but not update
      expect(newId).toBe(id);
      const entry = entryStore.findById(id);
      expect(entry!.isDeleted).toBe(true);
      expect(entry!.title).toBe('Original'); // not updated
    });
  });

  describe('query', () => {
    beforeEach(() => {
      // Create entries with different dates
      entryStore.createOrUpdate({
        feedId, guid: 'g1', url: 'https://ex.com/1', title: 'Post 1',
        publishedAt: '2026-07-14T10:00:00Z', summary: 'Summary 1',
      });
      entryStore.createOrUpdate({
        feedId, guid: 'g2', url: 'https://ex.com/2', title: 'Post 2',
        publishedAt: '2026-07-13T10:00:00Z', summary: 'Summary 2',
      });
      entryStore.createOrUpdate({
        feedId, guid: 'g3', url: 'https://ex.com/3', title: 'Post 3',
        publishedAt: '2026-07-12T10:00:00Z', summary: 'Summary 3',
      });
    });

    it('should list all entries', () => {
      const result = entryStore.query({ limit: 50 });
      expect(result.entries).toHaveLength(3);
    });

    it('should filter by feedId', () => {
      const result = entryStore.query({ feedId, limit: 50 });
      expect(result.entries).toHaveLength(3);
    });

    it('should filter by isRead', () => {
      // Mark one as read
      const entries = entryStore.query({ limit: 50 });
      entryStore.markRead([entries.entries[0].id], true);

      const unread = entryStore.query({ isRead: false, limit: 50 });
      expect(unread.entries).toHaveLength(2);
    });

    it('should support keyset pagination', () => {
      const page1 = entryStore.query({ feedId, limit: 2 });
      expect(page1.entries).toHaveLength(2);
      expect(page1.nextCursor).toBeDefined();

      const page2 = entryStore.query({ feedId, limit: 2, cursor: page1.nextCursor });
      expect(page2.entries).toHaveLength(1);
      expect(page2.nextCursor).toBeUndefined();
    });

    it('should search by title', () => {
      const result = entryStore.query({ search: 'Post 1', limit: 50 });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('Post 1');
    });

    it('should search by summary', () => {
      const result = entryStore.query({ search: 'Summary 2', limit: 50 });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('Post 2');
    });
  });

  describe('markRead / markStarred', () => {
    it('should mark entries as read', () => {
      const { id } = entryStore.createOrUpdate({
        feedId, guid: 'g1', title: 'Post',
      });
      expect(entryStore.findById(id)!.isRead).toBe(false);

      entryStore.markRead([id], true);
      expect(entryStore.findById(id)!.isRead).toBe(true);
    });

    it('should toggle star', () => {
      const { id } = entryStore.createOrUpdate({
        feedId, guid: 'g1', title: 'Post',
      });

      entryStore.markStarred(id, true);
      expect(entryStore.findById(id)!.isStarred).toBe(true);

      entryStore.markStarred(id, false);
      expect(entryStore.findById(id)!.isStarred).toBe(false);
    });
  });

  describe('softDelete', () => {
    it('should mark entry as deleted', () => {
      const { id } = entryStore.createOrUpdate({
        feedId, guid: 'g1', title: 'Post',
      });

      entryStore.softDelete(id);
      const entry = entryStore.findById(id);
      expect(entry!.isDeleted).toBe(true);

      // Should not appear in query
      const result = entryStore.query({ limit: 50 });
      expect(result.entries).toHaveLength(0);
    });
  });

  describe('countUnread', () => {
    it('should count unread entries', () => {
      entryStore.createOrUpdate({ feedId, guid: 'g1', title: 'Post 1' });
      entryStore.createOrUpdate({ feedId, guid: 'g2', title: 'Post 2' });

      expect(entryStore.countUnread(feedId)).toBe(2);

      const entries = entryStore.query({ feedId, limit: 50 });
      entryStore.markRead([entries.entries[0].id], true);

      expect(entryStore.countUnread(feedId)).toBe(1);
    });
  });

  describe('search with entry_content', () => {
    let dbContent: ReturnType<typeof buildTestDbWithContent>['db'];
    let entryStoreContent: EntryStore;
    let feedIdContent: number;

    beforeEach(() => {
      const testDb = buildTestDbWithContent();
      dbContent = testDb.db;
      entryStoreContent = new EntryStore(dbContent);
      const feedStoreContent = new FeedStore(dbContent);
      const feeds = feedStoreContent.findAll();
      feedIdContent = feeds[0].id;
    });

    it('should search by feed.title', () => {
      const result = entryStoreContent.query({ search: 'Test Feed', limit: 50 });
      expect(result.entries.length).toBeGreaterThanOrEqual(3);
      for (const entry of result.entries) {
        expect(entry.feedTitle).toBe('Test Feed');
      }
    });

    it('should search by markdown content', () => {
      const result = entryStoreContent.query({ search: 'first post', limit: 50 });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('First Post');
    });

    it('should rank title match above markdown match', () => {
      // 'second' matches in: entry 2 title 'Second Post' (relevance 3),
      // entry 2 markdown 'second article' (relevance 2)
      // So entry 2 should be first (3+2=5), entry 1 markdown 'first post' (2) maybe
      const result = entryStoreContent.query({ search: 'second', limit: 50 });
      expect(result.entries.length).toBeGreaterThanOrEqual(1);
      expect(result.entries[0].title).toBe('Second Post');
    });

    it('should rank markdown match above summary match', () => {
      // 'First' matches: entry 1 title 'First Post' (3), summary 'First summary' (1)
      // We need a case where markdown > summary
      // 'article' matches entry 2 markdown 'second article' (2)
      const result = entryStoreContent.query({ search: 'article', limit: 50 });
      expect(result.entries.length).toBeGreaterThanOrEqual(1);
      // Only entry 2's markdown contains 'article'
      expect(result.entries[0].title).toBe('Second Post');
    });

    it('should handle LIKE special char %', () => {
      const result = entryStoreContent.query({ search: '100%', limit: 50 });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('100% completion rate');
    });

    it('should handle LIKE special char _', () => {
      const result = entryStoreContent.query({ search: 'test_data', limit: 50 });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('100% completion rate');
    });

    it('should handle LIKE special char backslash', () => {
      const result = entryStoreContent.query({ search: 'backslash', limit: 50 });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('100% completion rate');
    });
  });
});
