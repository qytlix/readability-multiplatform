import { describe, expect, it } from 'vitest';
import { replaceApiKeyInputValue } from '../../src/renderer/features/summary/ProviderSettings';

describe('replaceApiKeyInputValue', () => {
  it('replaces an existing field value instead of appending the pasted key', () => {
    const input = { value: 'old-key-834957' };

    replaceApiKeyInputValue(input, '  sk-replacement-key  ');

    expect(input.value).toBe('sk-replacement-key');
  });

  it('preserves digits that are part of the pasted API key', () => {
    const input = { value: 'old-key' };

    replaceApiKeyInputValue(input, 'sk-valid-key-123456');

    expect(input.value).toBe('sk-valid-key-123456');
  });
});
