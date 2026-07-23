import { describe, expect, it } from 'vitest';
import type {
  TranslationResult,
  TranslationState,
} from '../../src/shared/contracts/translation.types';
import { getRestoredTranslationReaderMode } from '../../src/renderer/features/translation/translationReaderMode';
import { getTranslatedTitleSegment } from '../../src/renderer/features/translation/TranslationPanel';

const completedResult = {
  status: 'succeeded',
} as TranslationResult;

describe('getRestoredTranslationReaderMode', () => {
  it('restores the bilingual view for a completed saved translation', () => {
    const state: TranslationState = {
      state: 'succeeded',
      result: completedResult,
    };

    expect(getRestoredTranslationReaderMode(state)).toBe('bilingual');
  });

  it.each<TranslationState>([
    { state: 'idle' },
    { state: 'stale' },
    { state: 'running', result: { ...completedResult, status: 'running' } },
    { state: 'failed', result: { ...completedResult, status: 'failed' } },
  ])('keeps incomplete translation state in the original view', (state) => {
    expect(getRestoredTranslationReaderMode(state)).toBe('original');
  });
});

describe('getTranslatedTitleSegment', () => {
  const result = {
    segments: [
      {
        sourceSegmentId: 'title',
        sourceType: 'title',
        status: 'succeeded',
        translatedHtml: '<h2>标题译文</h2>',
      },
      {
        sourceSegmentId: 'byline',
        sourceType: 'byline',
        status: 'succeeded',
        translatedHtml: '<p>作者译文</p>',
      },
    ],
  } as TranslationResult;

  it('returns only the completed title while the bilingual view is visible', () => {
    expect(getTranslatedTitleSegment(result, 'bilingual')?.sourceSegmentId)
      .toBe('title');
  });

  it('hides the translated title in the original view', () => {
    expect(getTranslatedTitleSegment(result, 'original')).toBeUndefined();
  });
});
