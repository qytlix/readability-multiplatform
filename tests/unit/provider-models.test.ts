import { describe, expect, it } from 'vitest';
import {
  GPT_SUMMARY_MODEL_OPTIONS,
  isGptSummaryModel,
} from '../../src/shared/contracts/provider.types';

describe('GPT Summary model options', () => {
  it.each([
    'gpt-5.6',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
  ])('allows the GPT-5.6 family model %s', (model) => {
    expect(isGptSummaryModel(model)).toBe(true);
  });

  it('exposes every GPT-5.6 family model in the selector', () => {
    expect(GPT_SUMMARY_MODEL_OPTIONS.map((option) => option.value)).toEqual(
      expect.arrayContaining([
        'gpt-5.6',
        'gpt-5.6-sol',
        'gpt-5.6-terra',
        'gpt-5.6-luna',
      ]),
    );
  });
});
