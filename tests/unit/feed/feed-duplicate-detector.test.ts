import { describe, expect, it, vi } from 'vitest';
import type { Feed, ParsedEntry } from '../../../src/shared/contracts/feed.types';
import { FeedDuplicateDetector } from '../../../src/main/feed/services/FeedDuplicateDetector';
import type { EntryStore } from '../../../src/main/feed/stores/EntryStore';

const existingFeed: Feed = {
  id: 1,
  title: 'xkcd RSS',
  feedURL: 'https://xkcd.com/rss.xml',
  lastSyncStatus: 'success',
  syncIntervalMin: 30,
  createdAt: '2026-07-29T00:00:00.000Z',
};

function entries(prefix: string, count: number): ParsedEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    guid: `${prefix}-${index}`,
    url: `https://xkcd.com/${prefix}/${index}/`,
    title: `${prefix} ${index}`,
  }));
}

describe('FeedDuplicateDetector', () => {
  it('warns when different feed URLs share most recent article identities', () => {
    const recent = entries('comic', 20);
    const entryStore = {
      findRecentIdentityEntries: vi.fn().mockReturnValue(recent),
    } as unknown as EntryStore;
    const detector = new FeedDuplicateDetector(entryStore);

    const warning = detector.findSuspectedDuplicate({
      title: 'xkcd Atom',
      feedURL: 'https://xkcd.com/atom.xml',
      entries: [
        ...recent.slice(0, 18),
        ...entries('atom-only', 2),
      ],
    }, [existingFeed]);

    expect(warning).toMatchObject({
      overlapCount: 18,
      comparedCount: 20,
      candidate: { feedURL: 'https://xkcd.com/atom.xml' },
      existing: { feedURL: 'https://xkcd.com/rss.xml' },
    });
    expect(warning?.reason).toContain('20 篇文章中有 18 篇');
  });

  it('does not warn merely because feeds share a host or title', () => {
    const entryStore = {
      findRecentIdentityEntries: vi.fn().mockReturnValue(entries('news', 20)),
    } as unknown as EntryStore;
    const detector = new FeedDuplicateDetector(entryStore);

    expect(detector.findSuspectedDuplicate({
      title: existingFeed.title,
      feedURL: 'https://xkcd.com/members.xml',
      entries: entries('members', 20),
    }, [existingFeed])).toBeUndefined();
  });

  it('does not block candidates without enough reliable article identities', () => {
    const entryStore = {
      findRecentIdentityEntries: vi.fn().mockReturnValue(entries('comic', 20)),
    } as unknown as EntryStore;
    const detector = new FeedDuplicateDetector(entryStore);

    expect(detector.findSuspectedDuplicate({
      feedURL: 'https://xkcd.com/atom.xml',
      entries: entries('comic', 4),
    }, [existingFeed])).toBeUndefined();
  });
});
