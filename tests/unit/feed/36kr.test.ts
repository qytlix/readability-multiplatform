import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FeedParserAdapter } from '../../../src/main/feed/parser/FeedParserAdapter';

const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/feeds');

function loadFixture(filename: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf-8');
}

describe('36kr feed (malformed XML)', () => {
  it('should parse 36kr-style feed with bare & and HTML entities in CDATA', async () => {
    const adapter = new FeedParserAdapter();
    const xml = loadFixture('36kr.xml');

    const result = await adapter.parse(xml, 'http://36kr.com/feed');
    expect(result.title).toBe('36kr News');
    expect(result.entries).toHaveLength(2);
    // Bare & in CDATA is preserved; &amp; in CDATA is decoded to &
    expect(result.entries[0].title).toBe('Test Article');
    // The CDATA content should be preserved including &nbsp;
    expect(result.entries[0].contentHtml).toContain('Test User');
    // &amp; in CDATA stays as &amp; in contentHtml (raw HTML)
    expect(result.entries[0].contentHtml).toContain('$19.99 &amp; up');
    // Title with proper &amp; entity
    expect(result.entries[1].title).toBe('Second Article with & in title');
  });
});