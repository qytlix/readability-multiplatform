import { beforeEach, describe, expect, it } from 'vitest';
import { EntryStore } from '../../src/main/feed/stores/EntryStore';
import { FeedStore } from '../../src/main/feed/stores/FeedStore';
import { TagService } from '../../src/main/tags/TagService';
import { TagStore } from '../../src/main/tags/TagStore';
import { buildTestDb } from '../fixtures/databases/feed-fixture';

describe('TagStore batch operations', () => {
  let entryStore: EntryStore;
  let tagService: TagService;
  let entryIds: number[];

  beforeEach(() => {
    const { db } = buildTestDb();
    entryStore = new EntryStore(db);
    const feedStore = new FeedStore(db);
    const feed = feedStore.create({
      title: 'Batch Feed',
      feedURL: 'https://example.com/batch.xml',
    });
    entryIds = [
      entryStore.createOrUpdate({ feedId: feed.id, guid: 'one', title: 'One' }).id,
      entryStore.createOrUpdate({ feedId: feed.id, guid: 'two', title: 'Two' }).id,
      entryStore.createOrUpdate({ feedId: feed.id, guid: 'three', title: 'Three' }).id,
    ];
    tagService = new TagService(new TagStore(db), entryStore);
  });

  it('adds one tag to every selected entry and returns their tag union', () => {
    tagService.tagEntries(entryIds.slice(0, 2), 'Research');
    tagService.tagEntry(entryIds[1], 'Later');

    expect(tagService.listByEntry(entryIds[0]).map((tag) => tag.name))
      .toEqual(['Research']);
    expect(tagService.listByEntry(entryIds[1]).map((tag) => tag.name))
      .toEqual(['Later', 'Research']);
    expect(tagService.listByEntries(entryIds.slice(0, 2)).map((tag) => tag.name))
      .toEqual(['Later', 'Research']);
  });

  it('removes a union tag only where it exists', () => {
    tagService.tagEntries(entryIds.slice(0, 2), 'Shared');
    const sharedTag = tagService.listByEntry(entryIds[0])[0];

    tagService.untagEntries([entryIds[0], entryIds[2]], sharedTag.id);

    expect(tagService.listByEntry(entryIds[0])).toEqual([]);
    expect(tagService.listByEntry(entryIds[1]).map((tag) => tag.name))
      .toEqual(['Shared']);
    expect(tagService.listByEntry(entryIds[2])).toEqual([]);
  });
});
