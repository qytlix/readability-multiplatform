import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ProviderSettings,
  replaceApiKeyInputValue,
  SAVED_API_KEY_MASK,
} from '../../src/renderer/features/summary/ProviderSettings';

describe('saved API key mask', () => {
  it('uses a fixed mask that does not reveal the saved key length', () => {
    expect(SAVED_API_KEY_MASK).toBe('••••••••••••••••');
  });
});

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

describe('ProviderSettings model routing fields', () => {
  it('renders separate Summary and Translation model inputs', () => {
    const markup = renderToStaticMarkup(createElement(ProviderSettings, {
      profile: {
        id: 1,
        providerKind: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'summary-model',
        summaryModel: 'summary-model',
        translationProviderKind: 'deepseek',
        translationBaseUrl: 'https://api.deepseek.com',
        translationModel: 'translation-model',
        isActive: true,
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:00.000Z',
        hasApiKey: true,
        hasSummaryApiKey: true,
        hasTranslationApiKey: true,
        tagProviderKind: 'openai',
        tagBaseUrl: 'https://api.openai.com/v1',
        tagModel: 'gpt-5.4-mini',
        hasTagApiKey: true,
        chatProviderKind: 'openai',
        chatBaseUrl: 'https://api.openai.com/v1',
        chatModel: 'gpt-5.4-mini',
        chatSupportsImages: false,
        hasChatApiKey: true,
        keyStorageMode: 'secure',
      },
      onSaved: () => undefined,
      mode: 'embedded',
    }));

    expect(markup).toContain('总结模型');
    expect(markup).toContain('value="summary-model"');
    expect(markup).toContain('翻译模型');
    expect(markup).toContain('value="translation-model"');
    expect(markup).toContain('value="deepseek"');
    expect(markup).toContain('value="https://api.deepseek.com"');
    expect(markup).toContain('AI 问答');
    expect(markup).toContain('问答模型');
    expect(markup).toContain('该模型支持图片输入');
    expect(markup).toContain('name="chat-provider-api-key"');
    expect(markup).toContain('测试问答连接');
  });
});
