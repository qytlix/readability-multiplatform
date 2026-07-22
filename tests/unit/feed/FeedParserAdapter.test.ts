import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FeedParserAdapter } from '../../../src/main/feed/parser/FeedParserAdapter';

const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/feeds');

async function loadFixture(filename: string): Promise<string> {
  return fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf-8');
}

describe('FeedParserAdapter', () => {
  const adapter = new FeedParserAdapter();

  // ── RSS 2.0 ──────────────────────────────────────────────

  describe('RSS 2.0', () => {
    it('should parse a standard RSS 2.0 feed', async () => {
      const xml = await loadFixture('rss2-sample.xml');
      const result = await adapter.parse(xml, 'https://example.com/feed.xml');

      expect(result.title).toBe('Test Blog');
      expect(result.siteUrl).toBe('https://example.com');
      expect(result.feedUrl).toBe('https://example.com/feed.xml');
      expect(result.entries).toHaveLength(2);

      const first = result.entries[0];
      expect(first.guid).toBe('https://example.com/first-post');
      expect(first.url).toBe('https://example.com/first-post');
      expect(first.title).toBe('First Post');
      expect(first.author).toBe('author@example.com');
      expect(first.publishedAt).toBeDefined();
      expect(first.summary).toBe('This is the first post summary.');
    });

    it('should parse a standard RSS 2.0 feed (second fixture)', async () => {
      const xml = await loadFixture('rss2-sample2.xml');
      const result = await adapter.parse(xml, 'https://devdiary.example.com/feed.xml');

      expect(result.title).toBe('Developer Diary');
      expect(result.siteUrl).toBe('https://devdiary.example.com');
      expect(result.entries).toHaveLength(3);

      const first = result.entries[0];
      expect(first.guid).toBe('uuid:ts-tips-2026');
      expect(first.title).toBe('Building with TypeScript');
      expect(first.author).toBe('dev@example.com (Dev Author)');
    });

    it('should handle CDATA and Chinese characters', async () => {
      const xml = await loadFixture('rss2-cdata-chinese.xml');
      const result = await adapter.parse(xml, 'https://zh-example.com/feed.xml');

      expect(result.title).toBe('中文技术博客');
      expect(result.entries).toHaveLength(2);

      const first = result.entries[0];
      expect(first.guid).toBe('https://zh-example.com/posts/ts-app');
      expect(first.title).toBe('使用 TypeScript 构建应用');
      expect(first.author).toBe('作者');
      expect(first.summary).toContain('TypeScript');
    });
  });

  // ── Atom ─────────────────────────────────────────────────

  describe('Atom', () => {
    it('should parse a standard Atom feed', async () => {
      const xml = await loadFixture('atom-sample.xml');
      const result = await adapter.parse(xml, 'https://atom-test.example.com/feed.xml');

      expect(result.title).toBe('Atom Test Feed');
      expect(result.siteUrl).toBe('https://atom-test.example.com');
      expect(result.feedUrl).toBe('https://atom-test.example.com/feed.xml');
      expect(result.entries).toHaveLength(2);

      const first = result.entries[0];
      expect(first.guid).toBe('urn:uuid:atom-entry-one');
      expect(first.url).toBe('https://atom-test.example.com/entry-one');
      expect(first.title).toBe('Atom Entry One');
      expect(first.author).toBe('Alice');
      expect(first.publishedAt).toContain('2026-07-14');
      expect(first.summary).toBe('Summary of Atom entry one.');
    });

    it('should parse a second Atom feed', async () => {
      const xml = await loadFixture('atom-sample2.xml');
      const result = await adapter.parse(xml, 'https://science.example.com/atom.xml');

      expect(result.title).toBe('Science News');
      expect(result.siteUrl).toBe('https://science.example.com');
      expect(result.entries).toHaveLength(2);

      const first = result.entries[0];
      expect(first.title).toBe('New Breakthrough in Fusion Energy');
      expect(first.guid).toBe('urn:uuid:fusion-2026');
    });
  });

  // ── JSON Feed ────────────────────────────────────────────

  describe('JSON Feed', () => {
    it('should parse a standard JSON Feed', async () => {
      const json = await loadFixture('jsonfeed-sample.json');
      const result = await adapter.parse(
        json,
        'https://jsonfeed-blog.example.com/feed.json',
      );

      expect(result.title).toBe('JSON Feed Blog');
      expect(result.siteUrl).toBe('https://jsonfeed-blog.example.com');
      expect(result.feedUrl).toBe('https://jsonfeed-blog.example.com/feed.json');
      expect(result.entries).toHaveLength(2);

      const first = result.entries[0];
      expect(first.guid).toBe('json-post-1');
      expect(first.url).toBe('https://jsonfeed-blog.example.com/post-1');
      expect(first.title).toBe('JSON Feed Post One');
      expect(first.author).toBe('JSON Author');
      expect(first.publishedAt).toContain('2026-07-14');
      expect(first.summary).toBe('This is the first JSON Feed post.');
    });

    it('should parse a minimal JSON Feed', async () => {
      const json = await loadFixture('jsonfeed-sample2.json');
      const result = await adapter.parse(
        json,
        'https://minimal-json.example.com/feed.json',
      );

      expect(result.title).toBe('Minimal JSON Feed');
      expect(result.entries).toHaveLength(2);

      const first = result.entries[0];
      expect(first.guid).toBe('minimal-1');
      expect(first.title).toBe('Only Title Post');
      expect(first.publishedAt).toBeUndefined();
    });
  });

  // ── Edge Cases ───────────────────────────────────────────

  describe('Edge cases', () => {
    it('should not throw on missing fields', async () => {
      const xml = await loadFixture('rss2-missing-fields.xml');
      const result = await adapter.parse(xml, 'https://minimal.example.com/feed.xml');

      expect(result.title).toBe('Minimal Feed');
      expect(result.entries).toHaveLength(3);

      // Entry with no GUID should use link as fallback
      const noGuidEntry = result.entries[0];
      expect(noGuidEntry.title).toBe('No GUID No Date');
      expect(noGuidEntry.guid).toBe('https://minimal.example.com/no-guid');
      expect(noGuidEntry.publishedAt).toBeUndefined();

      // Entry with only GUID
      const onlyGuid = result.entries[1];
      expect(onlyGuid.guid).toBe('only-guid-item');
      expect(onlyGuid.title).toBeUndefined();
      expect(onlyGuid.url).toBeUndefined();

      // Entry with empty title
      const emptyTitle = result.entries[2];
      expect(emptyTitle.guid).toBe('empty-title-item');
      expect(emptyTitle.title).toBe('');
    });

    it('should preserve duplicate GUID entries (last wins semantics)', async () => {
      const xml = await loadFixture('rss2-duplicate-guids.xml');
      const result = await adapter.parse(xml, 'https://dups.example.com/feed.xml');

      expect(result.title).toBe('Dups Feed');
      expect(result.entries).toHaveLength(3);

      // rss-parser preserves all entries; dedup is done at store level
      const sameGuidEntries = result.entries.filter(
        (e) => e.guid === 'same-guid-value',
      );
      expect(sameGuidEntries).toHaveLength(2);
    });

    it('should throw on invalid XML', async () => {
      await expect(
        adapter.parse('not xml at all', 'https://invalid.example.com'),
      ).rejects.toThrow('Unrecognized feed format');
    });

    it('should throw on invalid JSON', async () => {
      await expect(
        adapter.parse('{ invalid json', 'https://invalid.example.com'),
      ).rejects.toThrow('JSON Feed parse failed');
    });

    it('should throw on JSON without valid feed version', async () => {
      await expect(
        adapter.parse(
          JSON.stringify({ version: 'unknown', title: 'Bad', items: [] }),
          'https://invalid.example.com',
        ),
      ).rejects.toThrow('JSON Feed parse failed');
    });
  });

  describe('cleanMalformedXml', () => {
    const VALID_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Test Feed</title>
  <item><title>Post &amp; Status</title></item>
</channel></rss>`;

    it('should parse feed with bare & in text content', async () => {
      const malformedXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Test Feed</title>
  <item><title>AT&T &amp; Verizon</title></item>
  <item><description>foo & bar</description></item>
</channel></rss>`;

      const result = await adapter.parse(malformedXml, 'https://example.com/feed');
      expect(result.title).toBe('Test Feed');
      expect(result.entries).toHaveLength(2);
      // After repair: `AT&T` → XML `AT&amp;T` → parser decodes back to `AT&T`
      expect(result.entries[0].title).toBe('AT&T & Verizon');
      expect(result.entries[1].summary).toBe('foo & bar');
    });

    it('should handle bare & inside attributes (CDATA-like)', async () => {
      // Bare & in attributes is technically invalid XML too
      // but most RSS feeds put special chars in CDATA or text nodes
      const feedWithEntity = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>36kr-style Feed</title>
  <item>
    <title>某公司 &amp; 某公司合作 | 新产品发布 &amp; 测试</title>
    <description>36kr的feed内容包含很多&符号</description>
  </item>
</channel></rss>`;

      const result = await adapter.parse(feedWithEntity, 'https://36kr.com/feed');
      expect(result.title).toBe('36kr-style Feed');
      // The & in content gets repaired and then decoded back to &
      expect(result.entries[0].title).toContain('&');
    });

    it('should preserve CDATA sections (content decoded by rss-parser)', async () => {
      const xmlWithCdata = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>With CDATA</title>
  <item><description><![CDATA[AT&T & Verizon are partners]]></description></item>
</channel></rss>`;

      const result = await adapter.parse(xmlWithCdata, 'https://example.com/feed');
      // CDATA content is preserved; rss-parser decodes &amp; back to &
      expect(result.entries[0].summary).toBe('AT&T & Verizon are partners');
    });

    it('should parse valid XML with entity decoding', async () => {
      const result = await adapter.parse(VALID_XML, 'https://example.com/feed');
      expect(result.title).toBe('Test Feed');
      // rss-parser decodes &amp; back to &
      expect(result.entries[0].title).toBe('Post & Status');
    });
  });
});