import { describe, expect, it } from 'vitest';
import {
  entryListCopy,
  getEntryListHeading,
  getEntryListHeadingPresentation,
} from '../../../src/renderer/features/feeds/entryListPresentation';

describe('Entry list presentation', () => {
  it.each([
    ['all feeds, all articles', null, 'all', entryListCopy.allArticles],
    ['all feeds, unread', null, 'unread', entryListCopy.unreadArticles],
    ['all feeds, starred', null, 'starred', entryListCopy.starredArticles],
    ['a feed, all articles', 'Daily Feed', 'all', 'Daily Feed'],
    ['a feed, unread', 'Daily Feed', 'unread', 'Daily Feed · 未读文章'],
    ['a feed, starred', 'Daily Feed', 'starred', 'Daily Feed · 收藏文章'],
  ] as const)('maps %s to the current query heading', (
    _label,
    feedName,
    filter,
    expected,
  ) => {
    expect(getEntryListHeading({
      feedName,
      filter,
      hasActiveSearch: false,
    })).toBe(expected);
  });

  it('shows the current feed in a scoped search heading', () => {
    expect(getEntryListHeading({
      feedName: 'Daily Feed',
      filter: 'starred',
      hasActiveSearch: true,
    })).toBe(`Daily Feed · ${entryListCopy.searchResults}`);
  });

  it('shows the active list filter in a scoped search heading', () => {
    expect(getEntryListHeading({
      feedName: null,
      filter: 'starred',
      hasActiveSearch: true,
    })).toBe(`${entryListCopy.searchResults} · ${entryListCopy.starredArticles}`);
  });

  it('uses the global heading after switching a feed search to all feeds', () => {
    expect(getEntryListHeading({
      feedName: 'Daily Feed',
      filter: 'all',
      hasActiveSearch: true,
      searchAllFeeds: true,
    })).toBe(entryListCopy.searchResults);
  });

  it('keeps a feed-specific filter suffix distinct from the feed name', () => {
    expect(getEntryListHeadingPresentation({
      feedName: 'Daily Feed',
      filter: 'unread',
      hasActiveSearch: false,
    })).toEqual({
      text: 'Daily Feed · 未读文章',
      feedName: 'Daily Feed',
      filterSuffix: entryListCopy.unreadArticles,
    });
  });

  it('does not turn a global filter heading into a secondary suffix', () => {
    expect(getEntryListHeadingPresentation({
      feedName: null,
      filter: 'starred',
      hasActiveSearch: false,
    })).toEqual({
      text: entryListCopy.starredArticles,
      feedName: null,
      filterSuffix: null,
    });
  });
});
