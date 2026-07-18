import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FeedService } from '../../src/main/feed/services/FeedService';
import { FeedStore } from '../../src/main/feed/stores/FeedStore';
import { EntryStore } from '../../src/main/feed/stores/EntryStore';
import { FeedParserAdapter } from '../../src/main/feed/parser/FeedParserAdapter';
import { buildTestDb } from '../fixtures/databases/feed-fixture';

const MOCK_FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Test Blog</title>
  <link>https://blog.example.com</link>
  <item>
    <guid>post-1</guid>
    <title>First Post</title>
    <link>https://blog.example.com/1</link>
    <pubDate>Mon, 14 Jul 2026 10:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

function mockFetch(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: () => Promise.resolve(body),
    headers: { get: () => null },
    url: 'https://blog.example.com/feed.xml',
  });
}

describe('FeedService (M2 extensions)', () => {
  let service: FeedService;
  let feedStore: FeedStore;
  let entryStore: EntryStore;

  beforeEach(() => {
    const { db } = buildTestDb();
    feedStore = new FeedStore(db);
    entryStore = new EntryStore(db);
    const parser = new FeedParserAdapter();
    service = new FeedService(feedStore, entryStore, parser);
    global.fetch = mockFetch(200, MOCK_FEED_XML);
  });

  describe('updateFeed', () => {
    it('should update feed title', async () => {
      const { feed } = await service.addFeed('https://example.com/feed.xml');

      const updated = await service.updateFeed(feed.id, { title: 'New Title' });
      expect(updated.title).toBe('New Title');
      expect(feedStore.findById(feed.id)!.title).toBe('New Title');
    });

    it('should update feed siteURL', async () => {
      const { feed } = await service.addFeed('https://example.com/feed.xml');

      const updated = await service.updateFeed(feed.id, { siteURL: 'https://new.example.com' });
      expect(updated.siteURL).toBe('https://new.example.com');
    });

    it('should update syncIntervalMin', async () => {
      const { feed } = await service.addFeed('https://example.com/feed.xml');

      const updated = await service.updateFeed(feed.id, { syncIntervalMin: 60 });
      expect(updated.syncIntervalMin).toBe(60);
    });

    it('should throw for non-existent feed', async () => {
      await expect(
        service.updateFeed(999, { title: 'Nope' }),
      ).rejects.toThrow(/Feed not found/);
    });

    it('should handle partial updates', async () => {
      const { feed } = await service.addFeed('https://example.com/feed.xml');

      // Update only title, keep others unchanged
      const before = feedStore.findById(feed.id)!;
      const updated = await service.updateFeed(feed.id, { title: 'Only Title' });
      expect(updated.title).toBe('Only Title');
      expect(updated.siteURL).toBe(before.siteURL);
      expect(updated.syncIntervalMin).toBe(before.syncIntervalMin);
    });
  });

  describe('getFeedsSync', () => {
    it('should return feeds synchronously', async () => {
      await service.addFeed('https://a.example.com/feed.xml');

      const feedB = MOCK_FEED_XML.replace('Test Blog', 'Blog B');
      global.fetch = mockFetch(200, feedB);
      await service.addFeed('https://b.example.com/feed.xml');

      const feeds = service.getFeedsSync();
      expect(feeds).toHaveLength(2);
    });
  });
});