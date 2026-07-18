import { describe, it, expect, beforeEach } from 'vitest';
import { OPMLImportService } from '../../../src/main/feed/services/OPMLImportService';
import { FeedStore } from '../../../src/main/feed/stores/FeedStore';
import { buildTestDb } from '../../fixtures/databases/feed-fixture';

const VALID_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>My Subscriptions</title>
  </head>
  <body>
    <outline text="Tech" title="Tech">
      <outline text="Blog A" title="Blog A" xmlUrl="https://a.example.com/feed.xml" htmlUrl="https://a.example.com"/>
      <outline text="Blog B" title="Blog B" xmlUrl="https://b.example.com/feed.xml"/>
    </outline>
    <outline text="News" title="News">
      <outline text="News Site" title="News Site" xmlUrl="https://news.example.com/rss"/>
    </outline>
  </body>
</opml>`;

const SINGLE_FEED_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Single Feed</title>
  </head>
  <body>
    <outline text="Single Feed" title="Single Feed" xmlUrl="https://single.example.com/feed.xml"/>
  </body>
</opml>`;

const INVALID_XML = `<?xml version="1.0" encoding="UTF-8"?>
<not-opml>
  <something>This is not valid OPML</something>
</not-opml>`;

describe('OPMLImportService', () => {
  let service: OPMLImportService;
  let feedStore: FeedStore;

  beforeEach(() => {
    const { db } = buildTestDb();
    feedStore = new FeedStore(db);
    service = new OPMLImportService(feedStore);
  });

  describe('importFromContent — merge mode', () => {
    it('should import feeds from valid OPML', async () => {
      const result = await service.importFromContent(VALID_OPML, 'merge');

      expect(result.successCount).toBe(3);
      expect(result.skipCount).toBe(0);
      expect(result.failures).toHaveLength(0);
      expect(result.totalFound).toBe(3);

      const feeds = feedStore.findAll();
      expect(feeds).toHaveLength(3);
      expect(feeds.map((f) => f.feedURL)).toContain('https://a.example.com/feed.xml');
      expect(feeds.map((f) => f.feedURL)).toContain('https://b.example.com/feed.xml');
      expect(feeds.map((f) => f.feedURL)).toContain('https://news.example.com/rss');
    });

    it('should skip duplicates in merge mode', async () => {
      // First import
      await service.importFromContent(VALID_OPML, 'merge');

      // Second import
      const result = await service.importFromContent(VALID_OPML, 'merge');

      expect(result.successCount).toBe(0);
      expect(result.skipCount).toBe(3);
      expect(feedStore.findAll()).toHaveLength(3);
    });

    it('should merge new feeds with existing ones', async () => {
      await service.importFromContent(SINGLE_FEED_OPML, 'merge');

      expect(feedStore.findAll()).toHaveLength(1);

      const result = await service.importFromContent(VALID_OPML, 'merge');

      // 0 existing (no overlap) + 3 new
      expect(result.successCount).toBe(3);
      expect(result.skipCount).toBe(0);
      expect(feedStore.findAll()).toHaveLength(4);
    });

    it('should preserve feed titles from OPML', async () => {
      const result = await service.importFromContent(VALID_OPML, 'merge');

      expect(result.successCount).toBe(3);

      const blogA = feedStore.findByUrl('https://a.example.com/feed.xml');
      expect(blogA?.title).toBe('Blog A');
      expect(blogA?.siteURL).toBe('https://a.example.com');

      const news = feedStore.findByUrl('https://news.example.com/rss');
      expect(news?.title).toBe('News Site');
    });
  });

  describe('importFromContent — replace mode', () => {
    it('should replace all feeds with OPML content', async () => {
      // Add some existing feeds
      await service.importFromContent(SINGLE_FEED_OPML, 'merge');
      expect(feedStore.findAll()).toHaveLength(1);

      // Replace with VALID_OPML
      const result = await service.importFromContent(VALID_OPML, 'replace');

      expect(result.successCount).toBe(3);
      const feeds = feedStore.findAll();
      expect(feeds).toHaveLength(3);
      expect(feeds.find((f) => f.feedURL === 'https://single.example.com/feed.xml')).toBeUndefined();
    });

    it('should handle replace when no feeds exist', async () => {
      const result = await service.importFromContent(VALID_OPML, 'replace');

      expect(result.successCount).toBe(3);
      expect(feedStore.findAll()).toHaveLength(3);
    });
  });

  describe('error handling', () => {
    it('should reject non-OPML XML', async () => {
      await expect(
        service.importFromContent(INVALID_XML, 'merge'),
      ).rejects.toMatchObject({ code: 'OPML_INVALID' });
    });

    it('should reject completely invalid input', async () => {
      await expect(
        service.importFromContent('not even xml', 'merge'),
      ).rejects.toMatchObject({ code: 'OPML_INVALID' });
    });

    it('should return zero count for empty OPML', async () => {
      const emptyOpml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Empty</title></head>
  <body></body>
</opml>`;

      const result = await service.importFromContent(emptyOpml, 'merge');
      expect(result.successCount).toBe(0);
      expect(result.skipCount).toBe(0);
      expect(result.totalFound).toBe(0);
    });
  });
});