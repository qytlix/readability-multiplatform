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
      expect(result.entries[0].url).toBe('https://ex.com/1');
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

    it('should not search by feed-provided summary', () => {
      const result = entryStore.query({ search: 'Summary 2', limit: 50 });
      expect(result.entries).toHaveLength(0);
    });
  });

  describe('markRead / markStarred', () => {
    it('should mark entries as read', () => {
      const { id } = entryStore.createOrUpdate({
        feedId, guid: 'g1', title: 'Post',
      });
      expect(entryStore.findById(id)!.isRead).toBe(false);

      entryStore.markRead([id], true);
      expect(entryStore.findById(id)).toMatchObject({
        isRead: true,
        readingProgress: 1,
      });

      entryStore.markRead([id], false);
      expect(entryStore.findById(id)).toMatchObject({
        isRead: false,
        readingProgress: 0,
      });
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

  describe('reading progress', () => {
    it('marks an entry read only at the bottom and keeps its maximum resume position', () => {
      const { id } = entryStore.createOrUpdate({
        feedId, guid: 'progress-1', title: 'Progress post',
      });

      expect(entryStore.updateReadingProgress(id, 0.5)).toEqual({
        entryId: id,
        readingProgress: 0.5,
        isRead: false,
        becameRead: false,
      });
      expect(entryStore.findById(id)).toMatchObject({
        isRead: false,
        readingProgress: 0.5,
      });

      expect(entryStore.updateReadingProgress(id, 0.25)).toEqual({
        entryId: id,
        readingProgress: 0.5,
        isRead: false,
        becameRead: false,
      });

      expect(entryStore.updateReadingProgress(id, 1)).toEqual({
        entryId: id,
        readingProgress: 1,
        isRead: true,
        becameRead: true,
      });

      expect(entryStore.updateReadingProgress(id, 0.25)).toEqual({
        entryId: id,
        readingProgress: 1,
        isRead: true,
        becameRead: false,
      });
      expect(entryStore.findById(id)).toMatchObject({
        isRead: true,
        readingProgress: 1,
      });
    });

    it('rejects progress outside the persisted range', () => {
      const { id } = entryStore.createOrUpdate({
        feedId, guid: 'progress-invalid', title: 'Progress post',
      });

      expect(() => entryStore.updateReadingProgress(id, -0.01)).toThrow(RangeError);
      expect(() => entryStore.updateReadingProgress(id, 1.01)).toThrow(RangeError);
    });
  });

  describe('getReadStats', () => {
    it('returns exact global and per-feed counts and percentages', () => {
      const secondFeed = feedStore.create({
        title: 'Second Feed',
        feedURL: 'https://second.example.com/feed.xml',
      });
      const first = entryStore.createOrUpdate({
        feedId, guid: 'stats-1', title: 'First',
      });
      entryStore.createOrUpdate({
        feedId, guid: 'stats-2', title: 'Second',
      });
      const deleted = entryStore.createOrUpdate({
        feedId: secondFeed.id, guid: 'stats-3', title: 'Deleted',
      });
      entryStore.createOrUpdate({
        feedId: secondFeed.id, guid: 'stats-4', title: 'Unread',
      });

      entryStore.updateReadingProgress(first.id, 1);
      entryStore.softDelete(deleted.id);

      expect(entryStore.getReadStats()).toEqual({
        all: {
          total: 3,
          unread: 2,
          readPercentage: 33,
        },
        feeds: [
          {
            feedId,
            total: 2,
            unread: 1,
            readPercentage: 50,
          },
          {
            feedId: secondFeed.id,
            total: 1,
            unread: 1,
            readPercentage: 0,
          },
        ],
        tagCount: 0,
      });
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

    beforeEach(() => {
      const testDb = buildTestDbWithContent();
      dbContent = testDb.db;
      entryStoreContent = new EntryStore(dbContent);
    });

    it('should not search by feed.title', () => {
      const result = entryStoreContent.query({ search: 'Test Feed', limit: 50 });
      expect(result.entries).toHaveLength(0);
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

    it('should not match removed summary fields', () => {
      const result = entryStoreContent.query({ search: 'test_data', limit: 50 });
      expect(result.entries).toHaveLength(0);
    });

    it('should handle LIKE special char backslash', () => {
      const result = entryStoreContent.query({ search: 'backslash', limit: 50 });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('100% completion rate');
    });
  });

  describe('search edge cases', () => {
    let dbContent: ReturnType<typeof buildTestDbWithContent>['db'];
    let entryStoreContent: EntryStore;

    beforeEach(() => {
      const testDb = buildTestDbWithContent();
      dbContent = testDb.db;
      entryStoreContent = new EntryStore(dbContent);
    });

    it('should handle undefined search', () => {
      const result = entryStoreContent.query({ limit: 50 });
      expect(result.entries.length).toBeGreaterThanOrEqual(4);
    });

    it('should handle empty string search', () => {
      const result = entryStoreContent.query({ search: '', limit: 50 });
      expect(result.entries.length).toBeGreaterThanOrEqual(4);
    });

    it('should handle whitespace-only search', () => {
      const result = entryStoreContent.query({ search: '   ', limit: 50 });
      expect(result.entries.length).toBeGreaterThanOrEqual(4);
    });

    it('should find un-cleaned entry by title', () => {
      // Entry 3 has no entry_content but has title 'Third Post'
      const result = entryStoreContent.query({ search: 'Third Post', limit: 50 });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('Third Post');
    });

    it('should not find un-cleaned entry by markdown', () => {
      // 'body' appears only in entry 1 and 2 markdown, not in title/summary
      // Entry 3 has no entry_content, so it should NOT match
      const result = entryStoreContent.query({ search: 'body', limit: 50 });
      expect(result.entries).toHaveLength(2);
      expect(result.entries.map((e) => e.title)).toEqual(
        expect.arrayContaining(['First Post', 'Second Post']),
      );
    });

    it('should paginate search results', () => {
      const page1 = entryStoreContent.query({ search: 'Post', limit: 2 });
      expect(page1.entries).toHaveLength(2);
      expect(page1.nextCursor).toBeDefined();

      const page2 = entryStoreContent.query({
        search: 'Post', limit: 2, cursor: page1.nextCursor,
      });
      expect(page2.entries).toHaveLength(1);
      expect(page2.nextCursor).toBeUndefined();
    });
  });
  describe('structured filters', () => {
    let dbFilters: ReturnType<typeof buildTestDb>['db'];
    let entryStoreFilters: EntryStore;
    let feedStoreFilters: FeedStore;
    let filtersFeedId: number;

    beforeEach(() => {
      const testDb = buildTestDb();
      dbFilters = testDb.db;
      entryStoreFilters = new EntryStore(dbFilters);
      feedStoreFilters = new FeedStore(dbFilters);

      // Create two feeds with different titles
      const feed1 = feedStoreFilters.create({
        title: 'Tech News',
        feedURL: 'https://tech.example/feed',
      });
      const feed2 = feedStoreFilters.create({
        title: 'Science Daily',
        feedURL: 'https://science.example/feed',
      });

      filtersFeedId = feed1.id;

      // Create entries in feed1
      const e1 = entryStoreFilters.createOrUpdate({
        feedId: feed1.id,
        guid: 'f-e1', title: 'New AI Breakthrough', author: 'Alice',
        publishedAt: '2026-07-14T10:00:00Z',
      });
      const e2 = entryStoreFilters.createOrUpdate({
        feedId: feed1.id,
        guid: 'f-e2', title: 'Climate Change Report', author: 'Bob',
        publishedAt: '2026-07-13T10:00:00Z',
      });
      const e3 = entryStoreFilters.createOrUpdate({
        feedId: feed1.id,
        guid: 'f-e3', title: 'Tech Stocks Rise', author: 'Alice',
        publishedAt: '2026-07-12T10:00:00Z',
      });
      // Mark e3 as starred separately
      entryStoreFilters.markStarred(e3.id, true);
      // Create entry in feed2
      const e4 = entryStoreFilters.createOrUpdate({
        feedId: feed2.id,
        guid: 'f-e4', title: 'New Physics Discovery', author: 'Charlie',
        publishedAt: '2026-07-11T10:00:00Z',
      });

      // Add content (markdown) for some entries
      const now = new Date().toISOString();
      dbFilters.prepare(`
        INSERT INTO entry_content (entryId, html, cleanedHtml, markdown, pipelineStatus, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(e1.id, '<html>1</html>', '<p>AI</p>', 'Deep learning and neural networks', 'success', now, now);
      dbFilters.prepare(`
        INSERT INTO entry_content (entryId, html, cleanedHtml, markdown, pipelineStatus, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(e2.id, '<html>2</html>', '<p>Climate</p>', 'Global temperature rising', 'success', now, now);
      // e3 and e4 intentionally left without entry_content

      // Create tags for entry 1
      dbFilters.prepare('INSERT INTO tag (id, name, color) VALUES (?, ?, ?)')
        .run(1, 'AI', 'hsl(200, 55%, 72%)');
      dbFilters.prepare('INSERT INTO tag (id, name, color) VALUES (?, ?, ?)')
        .run(2, 'Technology', 'hsl(160, 55%, 72%)');
      dbFilters.prepare('INSERT INTO tag (id, name, color) VALUES (?, ?, ?)')
        .run(3, 'Science', 'hsl(40, 55%, 72%)');

      dbFilters.prepare('INSERT INTO entry_tag (entryId, tagId, source, createdAt) VALUES (?, ?, ?, ?)')
        .run(e1.id, 1, 'manual', now); // AI -> e1
      dbFilters.prepare('INSERT INTO entry_tag (entryId, tagId, source, createdAt) VALUES (?, ?, ?, ?)')
        .run(e1.id, 2, 'manual', now); // Technology -> e1
      dbFilters.prepare('INSERT INTO entry_tag (entryId, tagId, source, createdAt) VALUES (?, ?, ?, ?)')
        .run(e4.id, 3, 'manual', now); // Science -> e4
    });

    it('tag: OR filter (operator="") matches entries with any of the tags', () => {
      const result = entryStoreFilters.query({
        filters: [
          { field: 'tag', operator: '', value: 'AI' },
        ],
        limit: 50,
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('New AI Breakthrough');
    });

    it('tag: OR with multiple values finds union of entries', () => {
      const result = entryStoreFilters.query({
        filters: [
          { field: 'tag', operator: '', value: 'AI' },
          { field: 'tag', operator: '', value: 'Science' },
        ],
        limit: 50,
      });
      expect(result.entries).toHaveLength(2);
      const titles = result.entries.map((e) => e.title);
      expect(titles).toContain('New AI Breakthrough');
      expect(titles).toContain('New Physics Discovery');
    });

    it('+tag: AND filter requires both tags', () => {
      const result = entryStoreFilters.query({
        filters: [
          { field: 'tag', operator: '+', value: 'AI' },
          { field: 'tag', operator: '+', value: 'Technology' },
        ],
        limit: 50,
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('New AI Breakthrough');
    });

    it('+tag: AND filter requires tag (fuzzy)', () => {
      const result = entryStoreFilters.query({
        filters: [
          { field: 'tag', operator: '+', value: 'Tech' },
        ],
        limit: 50,
      });
      // 'Tech' fuzzy-matches tag 'Technology' (e1) and 'Technology' (e1) via LIKE
      // e1: New AI Breakthrough has both 'AI' and 'Technology'
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('New AI Breakthrough');
    });

    it('+tag: AND filter requires tag (exact)', () => {
      // sidebar tag click produces operator='+' with match='exact' (Issue #112)
      const result = entryStoreFilters.query({
        filters: [
          { field: 'tag', operator: '+', value: 'Technology', match: 'exact' },
        ],
        limit: 50,
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('New AI Breakthrough');
    });

    it('+tag: exact non-match returns no entries', () => {
      const result = entryStoreFilters.query({
        filters: [
          { field: 'tag', operator: '+', value: 'Tech', match: 'exact' },
        ],
        limit: 50,
      });
      // 'Tech' is NOT an exact tag name (only 'Technology' exists)
      expect(result.entries).toHaveLength(0);
    });

    it('-tag: exclusion filter excludes tagged entries', () => {
      const result = entryStoreFilters.query({
        filters: [
          { field: 'tag', operator: '-', value: 'Sci' },
        ],
        limit: 50,
      });
      // 'Sci' fuzzy-matches 'Science' tag on e4, so only feed1 entries remain
      expect(result.entries).toHaveLength(3);
      const titles = result.entries.map((e) => e.title);
      expect(titles).not.toContain('New Physics Discovery');
      expect(titles).toContain('New AI Breakthrough');
      expect(titles).toContain('Climate Change Report');
      expect(titles).toContain('Tech Stocks Rise');
    });

    it('-tag: exclusion filter (exact) excludes only exact tag name', () => {
      const result = entryStoreFilters.query({
        filters: [
          { field: 'tag', operator: '-', value: 'Technology', match: 'exact' },
        ],
        limit: 50,
      });
      // Only e1 has 'Technology' tag, so it should be excluded
      expect(result.entries).toHaveLength(3);
      const titles = result.entries.map((e) => e.title);
      expect(titles).not.toContain('New AI Breakthrough');
      expect(titles).toContain('Climate Change Report');
      expect(titles).toContain('Tech Stocks Rise');
      expect(titles).toContain('New Physics Discovery');
    });

    it('feed: OR filter matches feed title substring', () => {
      const result = entryStoreFilters.query({
        filters: [
          { field: 'feed', operator: '', value: 'Science' },
        ],
        limit: 50,
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('New Physics Discovery');
    });

    it('title: filter matches title substring', () => {
      const result = entryStoreFilters.query({
        filters: [
          { field: 'title', operator: '', value: 'Climate' },
        ],
        limit: 50,
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('Climate Change Report');
    });

    it('content: filter matches markdown body', () => {
      const result = entryStoreFilters.query({
        filters: [
          { field: 'content', operator: '', value: 'neural' },
        ],
        limit: 50,
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('New AI Breakthrough');
    });

    it('author: filter matches author', () => {
      const result = entryStoreFilters.query({
        filters: [
          { field: 'author', operator: '', value: 'Alice' },
        ],
        limit: 50,
      });
      expect(result.entries).toHaveLength(2);
      const titles = result.entries.map((e) => e.title);
      expect(titles).toContain('New AI Breakthrough');
      expect(titles).toContain('Tech Stocks Rise');
    });

    it('starred:yes filter returns only starred entries', () => {
      const result = entryStoreFilters.query({
        filters: [
          { field: 'starred', operator: '', value: 'yes' },
        ],
        limit: 50,
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('Tech Stocks Rise');
    });

    it('starred:1 filter also works', () => {
      const result = entryStoreFilters.query({
        filters: [
          { field: 'starred', operator: '', value: '1' },
        ],
        limit: 50,
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('Tech Stocks Rise');
    });

    it('-starred:yes excludes starred entries', () => {
      const result = entryStoreFilters.query({
        filters: [
          { field: 'starred', operator: '-', value: 'yes' },
        ],
        limit: 50,
      });
      expect(result.entries).toHaveLength(3);
      expect(result.entries.map((entry) => entry.title)).not.toContain('Tech Stocks Rise');
    });

    it('-read:no returns only read entries', () => {
      const readEntry = entryStoreFilters.query({
        filters: [
          { field: 'title', operator: '', value: 'Climate' },
        ],
        limit: 50,
      }).entries[0];
      entryStoreFilters.markRead([readEntry.id], true);

      const result = entryStoreFilters.query({
        filters: [
          { field: 'read', operator: '-', value: 'no' },
        ],
        limit: 50,
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('Climate Change Report');
    });

    it('combines multiple filter types', () => {
      const result = entryStoreFilters.query({
        filters: [
          { field: 'feed', operator: '', value: 'Tech' },
          { field: 'author', operator: '', value: 'Alice' },
        ],
        limit: 50,
      });
      expect(result.entries).toHaveLength(2);
      const titles = result.entries.map((e) => e.title);
      expect(titles).toContain('New AI Breakthrough');
      expect(titles).toContain('Tech Stocks Rise');
    });

    it('combines filters with text search', () => {
      const result = entryStoreFilters.query({
        search: 'Breakthrough',
        filters: [
          { field: 'author', operator: '', value: 'Alice' },
        ],
        limit: 50,
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('New AI Breakthrough');
    });

    it('tag= (exact match) finds only exact tag name', () => {
      const result = entryStoreFilters.query({
        filters: [
          { field: 'tag', operator: '', value: 'Technology', match: 'exact' },
        ],
        limit: 50,
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('New AI Breakthrough');
    });

    it('tag: (fuzzy match) finds tag by substring', () => {
      // 'Tech' fuzzy-matches 'Technology' tag
      const result = entryStoreFilters.query({
        filters: [
          { field: 'tag', operator: '', value: 'Tech', match: 'fuzzy' },
        ],
        limit: 50,
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('New AI Breakthrough');
    });

    it('tag: without match defaults to fuzzy', () => {
      const result = entryStoreFilters.query({
        filters: [
          { field: 'tag', operator: '', value: 'Tech' },
        ],
        limit: 50,
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('New AI Breakthrough');
    });

    it('ORs repeated boolean filters', () => {
      const result = entryStoreFilters.query({
        filters: [
          { field: 'starred', operator: '', value: 'yes' },
          { field: 'starred', operator: '', value: 'no' },
        ],
        limit: 50,
      });
      expect(result.entries).toHaveLength(4);
    });

    it('rejects malformed filter objects with RangeError', () => {
      expect(() => entryStoreFilters.query({
        filters: [null],
        limit: 50,
      } as never)).toThrow(RangeError);
    });

    it('rejects filter values longer than the documented limit', () => {
      expect(() => entryStoreFilters.query({
        filters: [
          { field: 'title', operator: '', value: 'x'.repeat(101) },
        ],
        limit: 50,
      })).toThrow(RangeError);
    });

    it('rejects unsupported tag match modes', () => {
      expect(() => entryStoreFilters.query({
        filters: [
          { field: 'tag', operator: '', value: 'AI', match: 'prefix' },
        ],
        limit: 50,
      } as never)).toThrow(RangeError);
    });

    it('handles empty filters array', () => {
      const result = entryStoreFilters.query({
        filters: [],
        limit: 50,
      });
      expect(result.entries.length).toBeGreaterThanOrEqual(3);
    });

    it('returns entries with tags populated when using tag filters', () => {
      const result = entryStoreFilters.query({
        filters: [
          { field: 'tag', operator: '', value: 'AI' },
        ],
        limit: 50,
      });
      expect(result.entries).toHaveLength(1);
      const entry = result.entries[0];
      expect(entry.tags).toBeDefined();
      expect(entry.tags!.length).toBeGreaterThanOrEqual(1);
    });
  });
});
