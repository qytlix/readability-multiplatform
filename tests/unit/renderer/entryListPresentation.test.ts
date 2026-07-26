import { describe, expect, it } from 'vitest';
import {
  entryListCopy,
  getEntryListHeading,
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

  it('uses the global search heading because search queries ignore feed and filter scope', () => {
    expect(getEntryListHeading({
      feedName: 'Daily Feed',
      filter: 'starred',
      hasActiveSearch: true,
    })).toBe(entryListCopy.searchResults);
  });
});
