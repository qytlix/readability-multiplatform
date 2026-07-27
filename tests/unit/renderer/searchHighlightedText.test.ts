import { describe, expect, it } from 'vitest';
import {
  splitSearchHighlights,
} from '../../../src/renderer/features/search/SearchHighlightedText';

describe('search result highlighting', () => {
  it('highlights all query terms without treating operators as syntax', () => {
    expect(splitSearchHighlights(
      'SQLite keeps an AND token in SQLite text.',
      'sqlite AND',
    )).toEqual([
      { text: 'SQLite', matched: true },
      { text: ' keeps an ', matched: false },
      { text: 'AND', matched: true },
      { text: ' token in ', matched: false },
      { text: 'SQLite', matched: true },
      { text: ' text.', matched: false },
    ]);
  });

  it('prefers the longest term when matches overlap', () => {
    expect(splitSearchHighlights('database', 'data database')).toEqual([
      { text: 'database', matched: true },
    ]);
  });

  it('keeps unmatched text unchanged', () => {
    expect(splitSearchHighlights('<script>alert(1)</script>', 'safe')).toEqual([
      { text: '<script>alert(1)</script>', matched: false },
    ]);
  });
});
