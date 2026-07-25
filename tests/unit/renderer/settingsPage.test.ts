// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AISettingsPage } from '../../../src/renderer/features/settings/AISettingsPage';
import { DEFAULT_AI_PREFERENCES } from '../../../src/renderer/features/settings/aiPreferences';

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

    await act(async () => {
      root.render(createElement(AISettingsPage, {
        preferences: DEFAULT_AI_PREFERENCES,
        onPreferencesChange: vi.fn(),
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
      '摘要',
      '翻译',
      '术语库',
      'AI 专家',
      '快捷键',
      '模型服务',
      '诊断',
    ]);
    expect(container.querySelectorAll('.settings-page-content > [id^="settings-"]'))
      .toHaveLength(7);
    expect(container.textContent).not.toContain('Settings');

    const backButton = container.querySelector<HTMLButtonElement>('.settings-back-button');
    expect(backButton?.textContent).toContain('返回阅读');
    act(() => backButton?.click());
    expect(onClose).toHaveBeenCalledOnce();

    act(() => root.unmount());
    container.remove();
  });
});
