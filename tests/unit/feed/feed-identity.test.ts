import { describe, it, expect } from 'vitest';
import { normalizeFeedURL, isSameFeed } from '../../../src/main/feed/services/FeedIdentity';

describe('normalizeFeedURL', () => {
  describe('host normalization', () => {
    it('should lowercase host', () => {
      expect(normalizeFeedURL('https://XKCD.COM/feed.xml')).toBe(
        'https://xkcd.com/feed.xml',
      );
    });

    it('should lowercase mixed-case host', () => {
      expect(normalizeFeedURL('https://Example.COM/Feed')).toBe(
        'https://example.com/Feed',
      );
    });

    it('should keep already-lowercase host unchanged', () => {
      expect(normalizeFeedURL('https://xkcd.com/feed.xml')).toBe(
        'https://xkcd.com/feed.xml',
      );
    });
  });

  describe('default port removal', () => {
    it('should remove default https port 443', () => {
      expect(normalizeFeedURL('https://xkcd.com:443/feed.xml')).toBe(
        'https://xkcd.com/feed.xml',
      );
    });

    it('should remove default http port 80', () => {
      expect(normalizeFeedURL('http://example.com:80/feed.xml')).toBe(
        'http://example.com/feed.xml',
      );
    });

    it('should keep non-default port', () => {
      expect(normalizeFeedURL('https://xkcd.com:8080/feed.xml')).toBe(
        'https://xkcd.com:8080/feed.xml',
      );
    });

    it('should keep non-default http port', () => {
      expect(normalizeFeedURL('http://example.com:8080/feed')).toBe(
        'http://example.com:8080/feed',
      );
    });
  });

  describe('fragment removal', () => {
    it('should remove fragment', () => {
      expect(normalizeFeedURL('https://example.com/feed#section')).toBe(
        'https://example.com/feed',
      );
    });

    it('should remove fragment with query params', () => {
      expect(normalizeFeedURL('https://example.com/feed?key=val#section')).toBe(
        'https://example.com/feed?key=val',
      );
    });
  });

  describe('trailing slash removal', () => {
    it('should remove trailing slash from path', () => {
      expect(normalizeFeedURL('https://xkcd.com/feed/')).toBe(
        'https://xkcd.com/feed',
      );
    });

    it('should keep root path "/" as is', () => {
      expect(normalizeFeedURL('https://xkcd.com/')).toBe('https://xkcd.com/');
    });

    it('should handle root without trailing slash', () => {
      expect(normalizeFeedURL('https://xkcd.com')).toBe('https://xkcd.com/');
    });

    it('should handle multiple trailing slashes', () => {
      expect(normalizeFeedURL('https://example.com/feed//')).toBe(
        'https://example.com/feed',
      );
    });
  });

  describe('query parameters', () => {
    it('should preserve query parameters', () => {
      expect(normalizeFeedURL('https://feed.example.com/?key=abc123')).toBe(
        'https://feed.example.com/?key=abc123',
      );
    });

    it('should preserve multiple query params', () => {
      expect(normalizeFeedURL('https://example.com/feed?token=xyz&page=1')).toBe(
        'https://example.com/feed?token=xyz&page=1',
      );
    });
  });

  describe('protocol handling', () => {
    it('should preserve http vs https difference', () => {
      const http = normalizeFeedURL('http://xkcd.com/feed');
      const https = normalizeFeedURL('https://xkcd.com/feed');
      expect(http).not.toBe(https);
      expect(http).toBe('http://xkcd.com/feed');
      expect(https).toBe('https://xkcd.com/feed');
    });

    it('should preserve ftp protocol', () => {
      expect(normalizeFeedURL('ftp://example.com/feed')).toBe(
        'ftp://example.com/feed',
      );
    });
  });

  describe('path case sensitivity', () => {
    it('should preserve path case', () => {
      expect(normalizeFeedURL('https://xkcd.com/RSS.xml')).toBe(
        'https://xkcd.com/RSS.xml',
      );
    });

    it('should not merge different path cases', () => {
      const upper = normalizeFeedURL('https://xkcd.com/FEED');
      const lower = normalizeFeedURL('https://xkcd.com/feed');
      expect(upper).not.toBe(lower);
    });
  });

  describe('different endpoints', () => {
    it('should not merge rss and atom endpoints', () => {
      const rss = normalizeFeedURL('https://xkcd.com/rss');
      const atom = normalizeFeedURL('https://xkcd.com/atom');
      expect(rss).not.toBe(atom);
    });
  });

  describe('combined normalization', () => {
    it('should normalize host, port, fragment, and trailing slash together', () => {
      // ?keep=this is inside the fragment (#section?keep=this), not a real query param
      expect(
        normalizeFeedURL('HTTPS://XKCD.COM:443/Feed.xml/#section?keep=this'),
      ).toBe('https://xkcd.com/Feed.xml');
    });
  });

  describe('invalid URLs', () => {
    it('should throw for invalid URL', () => {
      expect(() => normalizeFeedURL('not-a-url')).toThrow();
    });

    it('should throw for empty string', () => {
      expect(() => normalizeFeedURL('')).toThrow();
    });
  });
});

describe('isSameFeed', () => {
  it('should return true for identical URLs', () => {
    expect(
      isSameFeed('https://xkcd.com/feed.xml', 'https://xkcd.com/feed.xml'),
    ).toBe(true);
  });

  it('should return true for URLs differing only in host case', () => {
    expect(
      isSameFeed('https://XKCD.COM/feed.xml', 'https://xkcd.com/feed.xml'),
    ).toBe(true);
  });

  it('should return true for URLs with default port vs without', () => {
    expect(
      isSameFeed('https://xkcd.com:443/feed', 'https://xkcd.com/feed'),
    ).toBe(true);
  });

  it('should return true for URLs differing in trailing slash', () => {
    expect(
      isSameFeed('https://xkcd.com/feed/', 'https://xkcd.com/feed'),
    ).toBe(true);
  });

  it('should return true for URLs with fragment', () => {
    expect(
      isSameFeed('https://xkcd.com/feed#section', 'https://xkcd.com/feed'),
    ).toBe(true);
  });

  it('should return false for different protocols', () => {
    expect(
      isSameFeed('http://xkcd.com/feed', 'https://xkcd.com/feed'),
    ).toBe(false);
  });

  it('should return false for different paths', () => {
    expect(
      isSameFeed('https://xkcd.com/rss', 'https://xkcd.com/atom'),
    ).toBe(false);
  });

  it('should return false for different path cases', () => {
    expect(
      isSameFeed('https://xkcd.com/Feed', 'https://xkcd.com/feed'),
    ).toBe(false);
  });

  it('should return false for different hosts', () => {
    expect(
      isSameFeed('https://example.com/feed', 'https://other.com/feed'),
    ).toBe(false);
  });

  it('should return false for different query params', () => {
    expect(
      isSameFeed('https://example.com/feed?key=1', 'https://example.com/feed?key=2'),
    ).toBe(false);
  });
});
