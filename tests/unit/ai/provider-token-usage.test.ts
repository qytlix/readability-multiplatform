import { describe, expect, it } from 'vitest';
import {
  getUsageAvailability,
  normalizeProviderTokenUsage,
  sanitizeProviderTokenUsage,
} from '../../../src/main/ai/provider/ProviderTokenUsage';

describe('Provider token usage normalization', () => {
  it('accepts the input/output naming variant', () => {
    expect(normalizeProviderTokenUsage({
      input_tokens: 11,
      output_tokens: 7,
      total_tokens: 18,
    })).toEqual({ inputTokens: 11, outputTokens: 7, totalTokens: 18 });
  });

  it('prefers prompt/completion fields when both naming variants are returned', () => {
    expect(normalizeProviderTokenUsage({
      prompt_tokens: 11,
      completion_tokens: 7,
      input_tokens: 111,
      output_tokens: 77,
      total_tokens: 18,
    })).toEqual({ inputTokens: 11, outputTokens: 7, totalTokens: 18 });
  });

  it('does not estimate missing values and classifies partial or missing usage', () => {
    const partial = sanitizeProviderTokenUsage({ inputTokens: 11, outputTokens: 7 });

    expect(partial).toEqual({ inputTokens: 11, outputTokens: 7 });
    expect(getUsageAvailability(partial)).toBe('partial');
    expect(getUsageAvailability(undefined)).toBe('missing');
    expect(normalizeProviderTokenUsage({ input_tokens: -1 })).toBeUndefined();
  });
});
