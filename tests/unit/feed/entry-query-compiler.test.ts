import { describe, expect, it } from 'vitest';
import type { EntryQuery } from '../../../src/shared/contracts/feed.types';
import {
  compileEntryQueryScope,
  escapeLikePattern,
} from '../../../src/main/feed/stores/EntryQueryCompiler';

describe('EntryQueryCompiler', () => {
  it('compiles feed, read, and starred scope into ordered parameters', () => {
    expect(compileEntryQueryScope({
      limit: 50,
      feedId: 7,
      isRead: false,
      isStarred: true,
    })).toEqual({
      conditions: [
        'e.feedId = ?',
        'e.isRead = ?',
        'e.isStarred = ?',
      ],
      parameters: [7, 0, 1],
    });
  });

  it('compiles mixed tag and text filters while escaping LIKE input', () => {
    const result = compileEntryQueryScope({
      limit: 50,
      filters: [
        { field: 'tag', operator: '', value: 'AI%', match: 'fuzzy' },
        { field: 'tag', operator: '', value: 'ML', match: 'exact' },
        { field: 'title', operator: '+', value: '100%_done' },
        { field: 'author', operator: '-', value: 'Bot' },
      ],
    });

    expect(result.conditions).toHaveLength(4);
    expect(result.conditions[0]).toContain('search_normalize(e.title) LIKE ?');
    expect(result.conditions[1]).toContain('e.author IS NULL');
    expect(result.conditions[2]).toContain('t.name LIKE ?');
    expect(result.conditions[3]).toContain('t.name = ?');
    expect(result.parameters).toEqual([
      '%100\\%\\_done%',
      '%Bot%',
      '%AI\\%%',
      'ML',
    ]);
  });

  it('groups same-field optional filters into one OR condition', () => {
    const result = compileEntryQueryScope({
      limit: 20,
      filters: [
        { field: 'feed', operator: '', value: 'First' },
        { field: 'feed', operator: '', value: 'Second_' },
      ],
    });

    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0]).toContain(' OR ');
    expect(result.parameters).toEqual(['%First%', '%Second\\_%']);
  });

  it('rejects malformed queries before any database access', () => {
    expect(() => compileEntryQueryScope({ limit: 0 }))
      .toThrow('Entry query limit must be between 1 and 100.');
    expect(() => compileEntryQueryScope({
      limit: 20,
      feedId: -1,
    })).toThrow('Entry query feedId must be a positive integer.');
    expect(() => compileEntryQueryScope({
      limit: 20,
      filters: [{ field: 'unknown', operator: '', value: 'x' }],
    } as unknown as EntryQuery)).toThrow('Invalid filter field');
    expect(() => compileEntryQueryScope({
      limit: 20,
      cursor: { publishedAt: '', id: 1 },
    })).toThrow('Entry query cursor is invalid.');
  });

  it('escapes SQLite LIKE metacharacters literally', () => {
    expect(escapeLikePattern('a\\b%c_d')).toBe('a\\\\b\\%c\\_d');
  });
});
