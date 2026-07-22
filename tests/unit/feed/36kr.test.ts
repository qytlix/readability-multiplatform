import { describe, it, expect } from 'vitest';
import { FeedParserAdapter } from '../../../src/main/feed/parser/FeedParserAdapter';

describe('36kr real feed', () => {
  it('should parse without error', async () => {
    const adapter = new FeedParserAdapter();
    const response = await fetch('http://36kr.com/feed', {
      headers: { 'User-Agent': 'Shale/1.0 Feed Reader' },
      signal: AbortSignal.timeout(15000),
    });
    const xml = await response.text();
    expect(xml.length).toBeGreaterThan(0);

    const result = await adapter.parse(xml, 'http://36kr.com/feed');
    expect(result.title).toBeTruthy();
    expect(result.entries.length).toBeGreaterThan(0);
    // Spot-check: some entries have content
    expect(result.entries.some((e) => e.title)).toBe(true);
  }, 20000);
});