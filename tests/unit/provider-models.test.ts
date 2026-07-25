import { describe, expect, it } from 'vitest';
import {
  getProviderPreset,
  GPT_SUMMARY_MODEL_OPTIONS,
  isGptSummaryModel,
  isProviderKind,
  isValidProviderModel,
  PROVIDER_PRESETS,
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

describe('provider presets', () => {
  it('exposes five hosted providers plus a custom OpenAI-compatible option', () => {
    expect(PROVIDER_PRESETS.map((preset) => preset.kind)).toEqual([
      'openai',
      'anthropic',
      'deepseek',
      'gemini',
      'openrouter',
      'custom-openai-compatible',
    ]);
    expect(getProviderPreset('anthropic').protocol).toBe('anthropic-messages');
    expect(getProviderPreset('gemini').protocol).toBe('gemini-generate-content');
    expect(getProviderPreset('deepseek').protocol).toBe('openai-chat-completions');
  });

  it('validates provider kinds and safe editable model IDs', () => {
    expect(isProviderKind('openrouter')).toBe(true);
    expect(isProviderKind('openai-compatible')).toBe(false);
    expect(isValidProviderModel('anthropic/claude-sonnet-4.5')).toBe(true);
    expect(isValidProviderModel('bad model')).toBe(false);
  });
});
