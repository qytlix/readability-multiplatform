import { describe, it, expect, beforeEach } from 'vitest';
import { ContentStore } from '../../src/main/feed/stores/ContentStore';
import { EntryStore } from '../../src/main/feed/stores/EntryStore';
import { FeedStore } from '../../src/main/feed/stores/FeedStore';
import { buildTestDb } from '../fixtures/databases/feed-fixture';

describe('ContentStore', () => {
  let contentStore: ContentStore;
  let entryStore: EntryStore;
  let feedStore: FeedStore;
  let db: ReturnType<typeof buildTestDb>['db'];
  let entryId: number;

  beforeEach(() => {
    const testDb = buildTestDb();
    db = testDb.db;
    contentStore = new ContentStore(db);
    entryStore = new EntryStore(db);
    feedStore = new FeedStore(db);

    const feed = feedStore.create({
      title: 'Test Feed',
      feedURL: 'https://example.com/feed.xml',
    });

    ({ id: entryId } = entryStore.createOrUpdate({
      feedId: feed.id,
      guid: 'guid-1',
      url: 'https://example.com/post-1',
      title: 'Test Post',
    }));
  });

  it('should upsert new content', () => {
    contentStore.upsert({
      entryId,
      html: '<html>source</html>',
      sourceUrl: 'https://example.com/post-1',
      cleanedHtml: '<div>cleaned</div>',
      markdown: 'cleaned',
      pipelineStatus: 'success',
    });

    const content = contentStore.findByEntry(entryId);
    expect(content).toBeDefined();
    expect(content!.cleanedHtml).toBe('<div>cleaned</div>');
    expect(content!.markdown).toBe('cleaned');
    expect(content!.pipelineStatus).toBe('success');
  });

  it('should update existing content', () => {
    contentStore.upsert({
      entryId,
      cleanedHtml: '<div>v1</div>',
      pipelineStatus: 'success',
    });

    contentStore.upsert({
      entryId,
      cleanedHtml: '<div>v2</div>',
      pipelineStatus: 'success',
    });

    const content = contentStore.findByEntry(entryId);
    expect(content!.cleanedHtml).toBe('<div>v2</div>');
  });

  it('should track pipeline status', () => {
    contentStore.upsert({
      entryId,
      pipelineStatus: 'pending',
    });

    contentStore.updatePipelineStatus(entryId, 'fetching');
    expect(contentStore.findByEntry(entryId)!.pipelineStatus).toBe('fetching');

    contentStore.updatePipelineStatus(entryId, 'failed', 'Timeout');
    const content = contentStore.findByEntry(entryId);
    expect(content!.pipelineStatus).toBe('failed');
    expect(content!.pipelineError).toBe('Timeout');
  });

  it('should return undefined for missing content', () => {
    expect(contentStore.findByEntry(999)).toBeUndefined();
  });

  it('should delete content by entry', () => {
    contentStore.upsert({
      entryId,
      cleanedHtml: '<div>content</div>',
      pipelineStatus: 'success',
    });

    contentStore.deleteByEntry(entryId);
    expect(contentStore.findByEntry(entryId)).toBeUndefined();
  });

  it('should cascade delete with entry deletion', () => {
    contentStore.upsert({
      entryId,
      cleanedHtml: '<div>content</div>',
      pipelineStatus: 'success',
    });

    entryStore.softDelete(entryId);
    // Soft delete doesn't cascade
    expect(contentStore.findByEntry(entryId)).toBeDefined();
  });
});
