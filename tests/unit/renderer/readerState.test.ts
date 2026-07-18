import { describe, expect, it } from 'vitest';
import { getReaderDisplayState } from '../../../src/renderer/features/feeds/readerState';

const selectedArticle = {
  feedLoadStatus: 'success' as const,
  feedCount: 1,
  entryLoadStatus: 'success' as const,
  entryCount: 1,
  hasSelectedEntry: true,
};

describe('Reader empty-state priority', () => {
  it('keeps loading and feed errors ahead of an empty feed collection', () => {
    expect(getReaderDisplayState({
      ...selectedArticle,
      feedLoadStatus: 'loading',
      feedCount: 0,
    })).toBe('feed-loading');
    expect(getReaderDisplayState({
      ...selectedArticle,
      feedLoadStatus: 'error',
      feedCount: 0,
    })).toBe('feed-error');
  });

  it('shows onboarding only after feeds have loaded and are empty', () => {
    expect(getReaderDisplayState({
      ...selectedArticle,
      feedCount: 0,
    })).toBe('no-feeds');
  });

  it('keeps article collection loading and errors ahead of No Articles', () => {
    expect(getReaderDisplayState({
      ...selectedArticle,
      entryLoadStatus: 'loading',
      entryCount: 0,
      hasSelectedEntry: false,
    })).toBe('entries-loading');
    expect(getReaderDisplayState({
      ...selectedArticle,
      entryLoadStatus: 'error',
      entryCount: 0,
      hasSelectedEntry: false,
    })).toBe('entries-error');
  });

  it('distinguishes No Articles, no selection, and an active article', () => {
    expect(getReaderDisplayState({
      ...selectedArticle,
      entryCount: 0,
      hasSelectedEntry: false,
    })).toBe('no-articles');
    expect(getReaderDisplayState({
      ...selectedArticle,
      hasSelectedEntry: false,
    })).toBe('no-selection');
    expect(getReaderDisplayState(selectedArticle)).toBe('article');
  });
});
