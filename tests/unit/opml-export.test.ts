import { describe, it, expect, beforeEach } from 'vitest';
import { OPMLExportService } from '../../src/main/feed/services/OPMLExportService';
import { FeedStore } from '../../src/main/feed/stores/FeedStore';
import { buildTestDb } from '../fixtures/databases/feed-fixture';

describe('OPMLExportService', () => {
  let service: OPMLExportService;
  let feedStore: FeedStore;

  beforeEach(() => {
    const { db } = buildTestDb();
    feedStore = new FeedStore(db);
    service = new OPMLExportService(feedStore);
  });

  describe('exportToContent', () => {
    it('should generate valid OPML for empty feed list', async () => {
      const xml = await service.exportToContent();

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<opml version="2.0">');
      expect(xml).toContain('</opml>');
      expect(xml).toContain('<body>');
      expect(xml).toContain('</body>');
    });

    it('should include all active feeds', async () => {
      feedStore.create({ title: 'Blog A', feedURL: 'https://a.example.com/feed.xml', siteURL: 'https://a.example.com' });
      feedStore.create({ title: 'Blog B', feedURL: 'https://b.example.com/feed.xml' });

      const xml = await service.exportToContent();

      expect(xml).toContain('Blog A');
      expect(xml).toContain('xmlUrl="https://a.example.com/feed.xml"');
      expect(xml).toContain('htmlUrl="https://a.example.com"');
      expect(xml).toContain('Blog B');
      expect(xml).toContain('xmlUrl="https://b.example.com/feed.xml"');
    });

    it('should escape special XML characters', async () => {
      feedStore.create({ title: 'Blog & "News" <Test>', feedURL: 'https://example.com/feed.xml' });

      const xml = await service.exportToContent();

      expect(xml).toContain('Blog &amp; &quot;News&quot; &lt;Test&gt;');
    });
  });
});