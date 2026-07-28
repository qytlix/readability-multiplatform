// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AISettingsPage } from '../../../src/renderer/features/settings/AISettingsPage';
import { DEFAULT_AI_PREFERENCES } from '../../../src/renderer/features/settings/aiPreferences';
import type { TranslationExpert } from '../../../src/shared/contracts/translation-expert.types';
import type { TerminologyLibrary } from '../../../src/shared/contracts/translation-terminology.types';

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe('full-screen settings page', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Chinese category navigation and returns to reading', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        provider: {
          get: vi.fn().mockResolvedValue({ ok: true, data: null }),
        },
        expert: {
          list: vi.fn().mockResolvedValue({ ok: true, data: { experts: [] } }),
        },
        terminology: {
          list: vi.fn().mockResolvedValue({ ok: true, data: { libraries: [] } }),
        },
      } as unknown as typeof window.shaleAPI,
    });

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onClose = vi.fn();
    const onReaderPreferencesChange = vi.fn();

    await act(async () => {
      root.render(createElement(AISettingsPage, {
        preferences: DEFAULT_AI_PREFERENCES,
        onPreferencesChange: vi.fn(),
        readerPreferences: { pageTurnAnimationEnabled: false },
        onReaderPreferencesChange,
        onClose,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const navigationLabels = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('.settings-navigation-links a'),
      (link) => link.textContent,
    );
    expect(navigationLabels).toEqual([
      '阅读',
      '摘要',
      '翻译',
      '术语库',
      'AI 专家',
      '快捷键',
      '标签生成',
      '模型服务',
      '用量统计',
      '诊断',
    ]);
    expect(container.querySelectorAll('.settings-page-content > [id^="settings-"]'))
      .toHaveLength(10);
    expect(container.textContent).not.toContain('Settings');

    const navigationIndicator = container.querySelector<HTMLElement>(
      '.settings-selection-indicator',
    );
    expect(navigationIndicator).not.toBeNull();
    expect(navigationIndicator?.style.opacity).toBe('1');
    expect(navigationLabels[0]).toBe('阅读');
    expect(
      container.querySelector<HTMLAnchorElement>(
        '.settings-navigation-links a.is-active',
      )?.getAttribute('href'),
    ).toBe('#settings-reading');

    const pageTurnToggle = container.querySelector<HTMLInputElement>(
      '#settings-reading input[type="checkbox"]',
    );
    expect(pageTurnToggle?.checked).toBe(false);
    act(() => pageTurnToggle?.click());
    expect(onReaderPreferencesChange).toHaveBeenCalledWith({
      pageTurnAnimationEnabled: true,
    });

    const translationLink = container.querySelector<HTMLAnchorElement>(
      '[data-settings-section="settings-translation"]',
    );
    await act(async () => translationLink?.click());
    expect(translationLink?.classList.contains('is-active')).toBe(true);
    expect(translationLink?.getAttribute('aria-current')).toBe('location');

    const settingsMain = container.querySelector<HTMLElement>('.settings-page-main');
    const translationSection = container.querySelector<HTMLElement>('#settings-translation');
    if (!settingsMain || !translationSection) {
      throw new Error('Settings scroll fixture did not render');
    }
    Object.defineProperties(settingsMain, {
      clientHeight: { configurable: true, value: 500 },
      scrollHeight: { configurable: true, value: 2_000 },
      scrollTop: { configurable: true, value: 40, writable: true },
    });
    vi.spyOn(settingsMain, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 500,
      height: 500,
      left: 0,
      right: 800,
      width: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(translationSection, 'getBoundingClientRect').mockReturnValue({
      top: 620,
      bottom: 1_020,
      height: 400,
      left: 0,
      right: 800,
      width: 800,
      x: 0,
      y: 620,
      toJSON: () => ({}),
    });

    await act(async () => settingsMain.dispatchEvent(new Event('scroll')));
    expect(translationLink?.classList.contains('is-active')).toBe(true);
    expect(translationLink?.getAttribute('aria-current')).toBe('location');

    const backButton = container.querySelector<HTMLButtonElement>('.settings-back-button');
    expect(backButton?.textContent).toContain('返回阅读');
    act(() => backButton?.click());
    expect(onClose).toHaveBeenCalledOnce();

    act(() => root.unmount());
    container.remove();
  });

  it('uses the shared sliding indicator and horizontal hover reveal', () => {
    const css = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../src/renderer/features/reader/ReaderPage.css',
      ),
      'utf8',
    );

    expect(css).toMatch(
      /\.settings-selection-indicator\s*\{[^}]*background: var\(--reader-accent\);[^}]*transform: translateY\(var\(--settings-selection-y, 0\)\);/s,
    );
    expect(css).toMatch(
      /\.settings-navigation-links a::after\s*\{[^}]*background: var\(--reader-sidebar-active\);[^}]*transform: scaleX\(0\);/s,
    );
    expect(css).toMatch(
      /\.settings-navigation-links a\.is-active::after\s*\{\s*transform: scaleX\(1\);/s,
    );
    expect(css).toMatch(
      /\.reader-page\[data-theme="light"\] \.shortcut-recorder\s*\{[^}]*color: var\(--reader-text\);[^}]*font-weight: 650;/s,
    );
  });

  it('shows only ten terminology libraries and experts until each list is expanded', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const experts: TranslationExpert[] = Array.from({ length: 12 }, (_, index) => ({
      id: `builtin:expert-${index + 1}`,
      version: '1.0.0',
      name: `专家 ${index + 1}`,
      description: `专家描述 ${index + 1}`,
      author: 'Official',
      details: '',
      origin: 'builtin',
      instruction: `Translate topic ${index + 1}.`,
      contentHash: `expert-hash-${index + 1}`,
      matches: [],
      warnings: [],
    }));
    const terminologyLibraries: TerminologyLibrary[] = Array.from(
      { length: 12 },
      (_, index) => ({
        id: `builtin:library-${index + 1}`,
        name: `术语库 ${index + 1}`,
        description: `术语库描述 ${index + 1}`,
        author: 'immersive',
        version: '1.0.0',
        origin: 'builtin',
        enabled: false,
        orderIndex: index,
        entryCount: index + 1,
        contentHash: `terminology-hash-${index + 1}`,
        availableTargetLanguages: ['zh-CN'],
        usesTraditionalChineseFallback: false,
        removable: false,
      }),
    );
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        provider: {
          get: vi.fn().mockResolvedValue({ ok: true, data: null }),
        },
        expert: {
          list: vi.fn().mockResolvedValue({
            ok: true,
            data: { experts },
          }),
        },
        terminology: {
          list: vi.fn().mockResolvedValue({
            ok: true,
            data: { libraries: terminologyLibraries, enabledSetHash: 'hash' },
          }),
        },
      } as unknown as typeof window.shaleAPI,
    });

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(AISettingsPage, {
        preferences: DEFAULT_AI_PREFERENCES,
        onPreferencesChange: vi.fn(),
        onClose: vi.fn(),
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelectorAll(
      '#settings-terminology .settings-option-card',
    )).toHaveLength(10);
    expect(container.querySelectorAll(
      '#settings-experts .settings-option-card',
    )).toHaveLength(10);

    const terminologyToggle = container.querySelector<HTMLButtonElement>(
      '#settings-terminology .settings-option-list-toggle',
    );
    const expertToggle = container.querySelector<HTMLButtonElement>(
      '#settings-experts .settings-option-list-toggle',
    );
    expect(terminologyToggle?.textContent).toBe('显示更多');
    expect(expertToggle?.textContent).toBe('显示更多');
    expect(terminologyToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(expertToggle?.getAttribute('aria-expanded')).toBe('false');

    act(() => terminologyToggle?.click());
    expect(container.querySelectorAll(
      '#settings-terminology .settings-option-card',
    )).toHaveLength(12);
    expect(container.querySelectorAll(
      '#settings-experts .settings-option-card',
    )).toHaveLength(10);
    expect(terminologyToggle?.textContent).toBe('收起');

    act(() => expertToggle?.click());
    expect(container.querySelectorAll(
      '#settings-experts .settings-option-card',
    )).toHaveLength(12);
    expect(expertToggle?.textContent).toBe('收起');

    act(() => root.unmount());
    container.remove();
  });

  it('renders terminology and experts as switch cards and preserves their selection behavior', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const expert: TranslationExpert = {
      id: 'builtin:technology',
      version: '1.0.0',
      name: '科技翻译专家',
      description: '提供准确、专业的科技领域翻译。',
      author: 'Official',
      details: '',
      origin: 'builtin',
      instruction: 'Translate technology content.',
      contentHash: 'expert-hash',
      matches: ['technology'],
      warnings: [
        'Selected systemPrompt.add_v.[1.17.2]; Shale transport prompts were discarded.',
        'Removed upstream transport instruction: Output only translated content.',
      ],
    };
    const terminologyLibrary: TerminologyLibrary = {
      id: 'builtin:technology',
      name: '科技',
      description: '涵盖硬件、AI 模型和主要科技公司。',
      author: 'immersive',
      version: '1.0.0',
      origin: 'builtin',
      enabled: false,
      orderIndex: 1,
      entryCount: 42,
      contentHash: 'terminology-hash',
      availableTargetLanguages: ['zh-CN'],
      usesTraditionalChineseFallback: true,
      removable: false,
    };
    const setTerminologyEnabled = vi.fn().mockResolvedValue({
      ok: true,
      data: { libraryId: terminologyLibrary.id, enabledSetHash: 'enabled-hash' },
    });
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        provider: {
          get: vi.fn().mockResolvedValue({ ok: true, data: null }),
        },
        expert: {
          list: vi.fn().mockResolvedValue({
            ok: true,
            data: { experts: [expert] },
          }),
        },
        terminology: {
          list: vi.fn().mockResolvedValue({
            ok: true,
            data: { libraries: [terminologyLibrary], enabledSetHash: 'hash' },
          }),
          setEnabled: setTerminologyEnabled,
        },
      } as unknown as typeof window.shaleAPI,
    });

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onPreferencesChange = vi.fn();

    await act(async () => {
      root.render(createElement(AISettingsPage, {
        preferences: DEFAULT_AI_PREFERENCES,
        onPreferencesChange,
        onClose: vi.fn(),
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelectorAll('.settings-option-grid')).toHaveLength(2);
    expect(container.querySelectorAll('.settings-option-card')).toHaveLength(2);
    expect(container.querySelector('#settings-experts select')).toBeNull();
    expect(container.textContent).not.toContain('台湾参考库');
    expect(container.textContent).not.toContain('Selected systemPrompt');
    expect(container.textContent).not.toContain('Removed upstream transport instruction');

    const terminologySwitch = container.querySelector<HTMLInputElement>(
      '#settings-terminology .settings-option-card input[role="switch"]',
    );
    const expertSwitch = container.querySelector<HTMLInputElement>(
      '#settings-experts .settings-option-card input[role="switch"]',
    );
    expect(terminologySwitch?.checked).toBe(false);
    expect(expertSwitch?.checked).toBe(false);

    await act(async () => {
      terminologySwitch?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(setTerminologyEnabled).toHaveBeenCalledWith({
      id: terminologyLibrary.id,
      enabled: true,
    });

    act(() => expertSwitch?.click());
    expect(onPreferencesChange).toHaveBeenCalledWith({
      ...DEFAULT_AI_PREFERENCES,
      translationExpertId: expert.id,
    });

    await act(async () => {
      root.render(createElement(AISettingsPage, {
        preferences: {
          ...DEFAULT_AI_PREFERENCES,
          translationExpertId: expert.id,
        },
        onPreferencesChange,
        onClose: vi.fn(),
      }));
    });
    const selectedExpertSwitch = container.querySelector<HTMLInputElement>(
      '#settings-experts .settings-option-card input[role="switch"]',
    );
    expect(selectedExpertSwitch?.checked).toBe(true);

    act(() => selectedExpertSwitch?.click());
    expect(onPreferencesChange).toHaveBeenLastCalledWith(DEFAULT_AI_PREFERENCES);

    act(() => root.unmount());
    container.remove();
  });

  it('keeps tag drafts local and rejects shortcut conflicts before saving', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, 'shaleAPI', {
      configurable: true,
      value: {
        provider: {
          get: vi.fn().mockResolvedValue({ ok: true, data: null }),
        },
        expert: {
          list: vi.fn().mockResolvedValue({ ok: true, data: { experts: [] } }),
        },
        terminology: {
          list: vi.fn().mockResolvedValue({
            ok: true,
            data: { libraries: [], enabledSetHash: 'hash' },
          }),
        },
      } as unknown as typeof window.shaleAPI,
    });

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onPreferencesChange = vi.fn();

    await act(async () => {
      root.render(createElement(AISettingsPage, {
        preferences: DEFAULT_AI_PREFERENCES,
        onPreferencesChange,
        onClose: vi.fn(),
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const tagTrigger = container.querySelector<HTMLSelectElement>(
      '#settings-tag-agent select',
    );
    if (!tagTrigger) {
      throw new Error('Tag Agent settings fixture did not render');
    }
    act(() => {
      tagTrigger.value = 'auto';
      tagTrigger.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onPreferencesChange).not.toHaveBeenCalled();

    const shortcutButtons = container.querySelectorAll<HTMLButtonElement>(
      '#settings-shortcuts .shortcut-recorder',
    );
    act(() => shortcutButtons[0].click());
    act(() => {
      shortcutButtons[0].dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Z',
        ctrlKey: true,
        bubbles: true,
      }));
    });
    expect(container.querySelector('.settings-shortcut-error')?.textContent)
      .toContain('已分配');
    expect(onPreferencesChange).not.toHaveBeenCalled();

    act(() => {
      shortcutButtons[0].dispatchEvent(new KeyboardEvent('keydown', {
        key: 'K',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }));
    });
    expect(onPreferencesChange).toHaveBeenLastCalledWith({
      ...DEFAULT_AI_PREFERENCES,
      fullTranslationShortcut: {
        key: 'K',
        ctrlKey: true,
        altKey: false,
        shiftKey: true,
        metaKey: false,
      },
    });

    onPreferencesChange.mockClear();
    const saveButton = container.querySelector<HTMLButtonElement>(
      '#settings-tag-agent .settings-save-btn',
    );
    act(() => saveButton?.click());
    expect(onPreferencesChange).toHaveBeenCalledWith({
      ...DEFAULT_AI_PREFERENCES,
      tagAgentTriggerMode: 'auto',
    });

    act(() => root.unmount());
    container.remove();
  });
});
