import { describe, expect, it } from 'vitest';
import type {
  TranslationResult,
  TranslationState,
} from '../../src/shared/contracts/translation.types';
import { getRestoredTranslationReaderMode } from '../../src/renderer/features/translation/translationReaderMode';

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
