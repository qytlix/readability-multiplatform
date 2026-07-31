// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderProfile } from '../../../src/shared/contracts/provider.types';
import { ArticleChatComposer } from '../../../src/renderer/features/chat/ArticleChatComposer';
import { ChatModelSwitcher } from '../../../src/renderer/features/chat/ChatModelSwitcher';
import {
  buildProviderRequestWithChatModel,
  getChatModelOptions,
} from '../../../src/renderer/features/chat/chatModelSelection';

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const profile: ProviderProfile = {
  id: 4,
  providerKind: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  summaryModel: 'gpt-5.4-mini',
  translationProviderKind: 'deepseek',
  translationBaseUrl: 'https://api.deepseek.com',
  translationModel: 'deepseek-v4-flash',
  tagProviderKind: 'openai',
  tagBaseUrl: 'https://api.openai.com/v1',
  tagModel: 'gpt-5.4-nano',
  chatProviderKind: 'openai',
  chatBaseUrl: 'https://api.openai.com/v1',
  chatModel: 'gpt-5.6-terra',
  chatSupportsImages: true,
  model: 'gpt-5.4-mini',
  isActive: true,
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
  hasApiKey: true,
  hasSummaryApiKey: true,
  hasTranslationApiKey: true,
  hasTagApiKey: true,
  hasChatApiKey: true,
};

describe('Article Chat model selection', () => {
  it('builds a full save request while changing only the chat model', () => {
    expect(buildProviderRequestWithChatModel(profile, 'gpt-5.6-sol')).toEqual({
      summary: {
        providerKind: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4-mini',
      },
      translation: {
        providerKind: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
      },
      tag: {
        providerKind: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4-nano',
      },
      chat: {
        providerKind: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.6-sol',
        supportsImages: true,
      },
    });
  });

  it('keeps a custom current model alongside the provider suggestions', () => {
    const customProfile = {
      ...profile,
      chatModel: 'company-custom-reasoner',
    };
    const options = getChatModelOptions(customProfile);

    expect(options[0]).toMatchObject({
      value: 'company-custom-reasoner',
      current: true,
    });
    expect(options.some(({ value }) => value === 'gpt-5.4-mini')).toBe(true);
  });
});

describe('ChatModelSwitcher', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('opens an upward model menu and selects a different model', async () => {
    const onSelectModel = vi.fn().mockResolvedValue(true);
    await act(async () => {
      root.render(createElement(ChatModelSwitcher, {
        profile,
        disabled: false,
        onSelectModel,
      }));
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label^="切换问答模型"]',
    );
    expect(trigger?.textContent).toContain('GPT-5.6 Terra');

    act(() => trigger?.click());
    const menu = container.querySelector('[role="listbox"]');
    expect(menu).not.toBeNull();
    expect(menu?.getAttribute('data-placement')).toBe('top');
    expect(
      menu?.querySelector('[role="option"][aria-selected="true"]')
        ?.textContent,
    ).toContain('GPT-5.6 Terra');

    const target = Array.from(
      menu?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    ).find((option) => option.dataset.model === 'gpt-5.6-sol');
    await act(async () => {
      target?.click();
      await Promise.resolve();
    });

    expect(onSelectModel).toHaveBeenCalledWith('gpt-5.6-sol');
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('places the model trigger immediately before the send button', async () => {
    await act(async () => {
      root.render(createElement(ArticleChatComposer, {
        entryId: 7,
        value: '请解释核心论点',
        running: false,
        busy: false,
        disabled: false,
        errorMessage: '',
        provider: profile,
        attachments: [],
        onChange: vi.fn(),
        onSend: vi.fn(),
        onStop: vi.fn(),
        onSelectModel: vi.fn().mockResolvedValue(true),
        onRemoveSelection: vi.fn(),
        onPickAttachments: vi.fn(),
        onRemoveAttachment: vi.fn(),
        onPasteImages: vi.fn(),
      }));
    });

    const composerBox = container.querySelector('.article-chat-composer-box');
    const modelTrigger = composerBox?.querySelector(
      '.article-chat-model-trigger',
    );
    const submitButton = composerBox?.querySelector(
      '.article-chat-submit-button',
    );
    const modelSwitcher = modelTrigger?.closest(
      '.article-chat-model-switcher',
    );

    expect(modelSwitcher?.nextElementSibling).toBe(submitButton);
  });
});
