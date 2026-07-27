import { beforeEach, describe, expect, it } from 'vitest';
import { ContentStore } from '../../src/main/feed/stores/ContentStore';
import { EntryStore } from '../../src/main/feed/stores/EntryStore';
import { FeedStore } from '../../src/main/feed/stores/FeedStore';
import { buildTestDb } from '../fixtures/databases/feed-fixture';

describe('optimized entry search', () => {
  let contentStore: ContentStore;
  let entryStore: EntryStore;
  let feedStore: FeedStore;
  let primaryFeedId: number;
  let secondaryFeedId: number;
  let sequence: number;

  beforeEach(() => {
    const { db } = buildTestDb();
    contentStore = new ContentStore(db);
    entryStore = new EntryStore(db);
    feedStore = new FeedStore(db);
    primaryFeedId = feedStore.create({
      title: 'Primary',
      feedURL: 'https://primary.example/feed',
    }).id;
    secondaryFeedId = feedStore.create({
      title: 'Secondary',
      feedURL: 'https://secondary.example/feed',
    }).id;
    sequence = 0;
  });

  const addEntry = ({
    title,
    markdown,
    feedId = primaryFeedId,
    publishedAt = `2026-07-${String(20 - sequence).padStart(2, '0')}T00:00:00.000Z`,
    isRead = false,
    isStarred = false,
  }: {
    title: string;
    markdown?: string;
    feedId?: number;
    publishedAt?: string;
    isRead?: boolean;
    isStarred?: boolean;
  }): number => {
    sequence += 1;
    const { id } = entryStore.createOrUpdate({
      feedId,
      guid: `entry-${sequence}`,
      title,
      publishedAt,
    });
    if (markdown !== undefined) {
      contentStore.upsert({ entryId: id, markdown, pipelineStatus: 'success' });
    }
    if (isRead) entryStore.markRead([id], true);
    if (isStarred) entryStore.markStarred(id, true);
    return id;
  };

  it('keeps feed, unread and starred filters active during search', () => {
    const expectedId = addEntry({
      title: 'Scoped database result',
      isStarred: true,
    });
    addEntry({ title: 'Read database result', isRead: true, isStarred: true });
    addEntry({
      title: 'Other feed database result',
      feedId: secondaryFeedId,
      isStarred: true,
    });

    const result = entryStore.query({
      feedId: primaryFeedId,
      isRead: false,
      isStarred: true,
      search: 'database',
      limit: 30,
    });

    expect(result.entries.map(({ id }) => id)).toEqual([expectedId]);
  });

  it('orders exact, prefix, title-contains and body-only matches by tier', () => {
    const bodyId = addEntry({
      title: 'Newest unrelated heading',
      markdown: 'A local search appears only in this body.',
      publishedAt: '2026-07-27T00:00:00.000Z',
    });
    const containsId = addEntry({
      title: 'Understanding local search today',
      publishedAt: '2026-07-26T00:00:00.000Z',
    });
    const prefixId = addEntry({
      title: 'Local search patterns',
      publishedAt: '2026-07-25T00:00:00.000Z',
    });
    const exactId = addEntry({
      title: 'Local search',
      publishedAt: '2026-07-24T00:00:00.000Z',
    });

    const result = entryStore.query({ search: 'local search', limit: 30 });
    expect(result.entries.map(({ id }) => id)).toEqual([
      exactId,
      prefixId,
      containsId,
      bodyId,
    ]);
    expect(result.entries.at(-1)?.searchSnippet).toContain('local search');
  });

  it('uses AND semantics for multiple terms and supports quoted phrases', () => {
    const bothId = addEntry({
      title: 'SQLite migration guide',
      markdown: 'Safe schema upgrades.',
    });
    addEntry({ title: 'SQLite guide', markdown: 'No schema discussion.' });
    addEntry({ title: 'Migration guide', markdown: 'No database name.' });

    expect(
      entryStore.query({ search: 'SQLite migration', limit: 30 })
        .entries.map(({ id }) => id),
    ).toEqual([bothId]);
    expect(
      entryStore.query({ search: '"SQLite migration"', limit: 30 })
        .entries.map(({ id }) => id),
    ).toEqual([bothId]);
  });

  it('falls back safely for short CJK text and uses trigram for longer CJK text', () => {
    const shortId = addEntry({
      title: '离线翻译实践',
      markdown: '适合本地阅读。',
    });
    const trigramId = addEntry({
      title: '数据库迁移实践',
      markdown: '保持事务一致。',
    });

    expect(
      entryStore.query({ search: '翻译', limit: 30 }).entries.map(({ id }) => id),
    ).toEqual([shortId]);
    expect(
      entryStore.query({ search: '数据库', limit: 30 }).entries.map(({ id }) => id),
    ).toEqual([trigramId]);
  });

  it('uses the same Unicode normalization for indexed text and queries', () => {
    const id = addEntry({
      title: 'Ｆｕｌｌｗｉｄｔｈ SQLite ﬁle',
      markdown: 'Compatibility forms remain searchable.',
    });

    expect(
      entryStore.query({ search: 'Fullwidth SQLite file', limit: 30 })
        .entries.map((entry) => entry.id),
    ).toEqual([id]);
  });

  it('paginates across relevance tiers without dropping newer body matches', () => {
    const exactId = addEntry({
      title: 'Ranked pagination',
      publishedAt: '2026-07-01T00:00:00.000Z',
    });
    const bodyId = addEntry({
      title: 'Newer body match',
      markdown: 'This article explains ranked pagination.',
      publishedAt: '2026-07-27T00:00:00.000Z',
    });

    const firstPage = entryStore.query({ search: 'ranked pagination', limit: 1 });
    expect(firstPage.entries.map(({ id }) => id)).toEqual([exactId]);
    expect(firstPage.nextCursor).toMatchObject({ matchTier: 4 });

    const secondPage = entryStore.query({
      search: 'ranked pagination',
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.entries.map(({ id }) => id)).toEqual([bodyId]);
    expect(secondPage.nextCursor).toBeUndefined();
  });
});
