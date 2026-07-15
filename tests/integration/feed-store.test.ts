import { describe, it, expect } from 'vitest';
import { FeedStore } from '../../src/main/feed/FeedStore';
import { buildTestDb } from '../fixtures/databases/feed-fixture';

describe('FeedStore', () => {
  it('should create a feed', () => {
    const { db } = buildTestDb();
    const store = new FeedStore(db);

    const feed = store.create({
      title: 'My Blog',
      feedURL: 'https://blog.example.com/feed.xml',
      siteURL: 'https://blog.example.com',
    });

    expect(feed.id).toBe(1);
    expect(feed.title).toBe('My Blog');
    expect(feed.feedURL).toBe('https://blog.example.com/feed.xml');
    expect(feed.lastSyncStatus).toBe('never');
    expect(feed.createdAt).toBeDefined();
  });

  it('should find by ID', () => {
    const { db } = buildTestDb();
    const store = new FeedStore(db);

    const created = store.create({
      title: 'My Blog',
      feedURL: 'https://blog.example.com/feed.xml',
    });

    const found = store.findById(created.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.title).toBe('My Blog');
  });

  it('should find by URL', () => {
    const { db } = buildTestDb();
    const store = new FeedStore(db);

    store.create({
      title: 'My Blog',
      feedURL: 'https://blog.example.com/feed.xml',
    });

    const found = store.findByUrl('https://blog.example.com/feed.xml');
    expect(found).toBeDefined();
    expect(found!.title).toBe('My Blog');
  });

  it('should return undefined for missing feed', () => {
    const { db } = buildTestDb();
    const store = new FeedStore(db);

    expect(store.findById(999)).toBeUndefined();
    expect(store.findByUrl('https://unknown.example.com')).toBeUndefined();
  });

  it('should find all feeds', () => {
    const { db } = buildTestDb();
    const store = new FeedStore(db);

    store.create({ title: 'Feed A', feedURL: 'https://a.example.com/feed.xml' });
    store.create({ title: 'Feed B', feedURL: 'https://b.example.com/feed.xml' });

    const feeds = store.findAll();
    expect(feeds).toHaveLength(2);
    expect(feeds[0].title).toBe('Feed A'); // alphabetical
    expect(feeds[1].title).toBe('Feed B');
  });

  it('should reject duplicate feedURL', () => {
    const { db } = buildTestDb();
    const store = new FeedStore(db);

    store.create({ title: 'Feed', feedURL: 'https://example.com/feed.xml' });

    expect(() => {
      store.create({ title: 'Duplicate', feedURL: 'https://example.com/feed.xml' });
    }).toThrow();
  });

  it('should update feed', () => {
    const { db } = buildTestDb();
    const store = new FeedStore(db);

    const feed = store.create({
      title: 'Old Title',
      feedURL: 'https://example.com/feed.xml',
    });

    const updated = store.update(feed.id, { title: 'New Title' });
    expect(updated!.title).toBe('New Title');
  });

  it('should update sync status', () => {
    const { db } = buildTestDb();
    const store = new FeedStore(db);

    const feed = store.create({
      title: 'Feed',
      feedURL: 'https://example.com/feed.xml',
    });

    store.updateSyncStatus(feed.id, 'success');
    const found = store.findById(feed.id);
    expect(found!.lastSyncStatus).toBe('success');
    expect(found!.lastFetchedAt).toBeDefined();

    store.updateSyncStatus(feed.id, 'error', 'Network error');
    const found2 = store.findById(feed.id);
    expect(found2!.lastSyncStatus).toBe('error');
    expect(found2!.lastSyncError).toBe('Network error');
  });

  it('should delete a feed', () => {
    const { db } = buildTestDb();
    const store = new FeedStore(db);

    const feed = store.create({
      title: 'Feed',
      feedURL: 'https://example.com/feed.xml',
    });

    store.delete(feed.id);
    expect(store.findById(feed.id)).toBeUndefined();
  });
});
