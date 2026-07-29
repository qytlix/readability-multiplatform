import { describe, expect, it, vi } from 'vitest';
import { OPMLImportService } from '../../../src/main/feed/services/OPMLImportService';
import { FeedStore } from '../../../src/main/feed/stores/FeedStore';
import type { FeedService } from '../../../src/main/feed/services/FeedService';
import { buildTestDb } from '../../fixtures/databases/feed-fixture';

const OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><body>
  <outline text="RSS" xmlUrl="https://xkcd.com/rss.xml" />
  <outline text="Atom" xmlUrl="https://xkcd.com/atom.xml" />
</body></opml>`;

describe('OPML suspected duplicate decisions', () => {
  it('returns warnings without silently adding a suspected duplicate', async () => {
    const { db } = buildTestDb();
    const addFeed = vi.fn(async (
      url: string,
      options?: { allowSuspectedDuplicate?: boolean },
    ) => {
      if (url.endsWith('/atom.xml') && !options?.allowSuspectedDuplicate) {
        throw {
          code: 'FEED_SUSPECTED_DUPLICATE',
          message: '内容高度重合',
          retryable: false,
          details: {
            candidate: { title: 'Atom', feedURL: url },
            existing: {
              id: 1,
              title: 'RSS',
              feedURL: 'https://xkcd.com/rss.xml',
            },
            overlapCount: 18,
            comparedCount: 20,
            reason: '最近 20 篇文章中有 18 篇链接相同',
          },
        };
      }
      return { feed: {}, entries: [] };
    });
    const feedService = { addFeed } as unknown as FeedService;
    const service = new OPMLImportService(
      new FeedStore(db),
      undefined,
      undefined,
      feedService,
    );

    const warningResult = await service.importFromContent(OPML, 'merge', 'warn');
    expect(warningResult.successCount).toBe(1);
    expect(warningResult.skipCount).toBe(1);
    expect(warningResult.suspectedDuplicates).toHaveLength(1);

    const keepResult = await service.importFromContent(OPML, 'merge', 'keep');
    expect(keepResult.successCount).toBe(2);
    expect(addFeed).toHaveBeenCalledWith(
      'https://xkcd.com/atom.xml',
      { allowSuspectedDuplicate: true },
    );
  });
});
