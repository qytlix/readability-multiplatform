import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import {
  DEFAULT_READER_THEME,
  loadReaderTheme,
  READER_THEME_STORAGE_KEY,
  saveReaderTheme,
} from '../../../src/renderer/features/appearance/theme';

const createStorage = (initialValue: string | null = null) => {
  let value = initialValue;
  return {
    getItem: (key: string) =>
      key === READER_THEME_STORAGE_KEY ? value : null,
    setItem: (key: string, nextValue: string) => {
      if (key === READER_THEME_STORAGE_KEY) value = nextValue;
    },
    read: () => value,
  };
};

describe('reader theme preferences', () => {
  it('keeps the existing night mode as the default', () => {
    expect(loadReaderTheme(createStorage())).toBe(DEFAULT_READER_THEME);
  });

  it('restores a saved day mode', () => {
    expect(loadReaderTheme(createStorage('light'))).toBe('light');
  });

  it('ignores invalid saved values', () => {
    expect(loadReaderTheme(createStorage('sepia'))).toBe('dark');
  });

  it('persists the selected theme', () => {
    const storage = createStorage();

    saveReaderTheme(storage, 'light');

    expect(storage.read()).toBe('light');
  });

  it('falls back safely when storage is unavailable', () => {
    const unavailableStorage = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: () => {
        throw new Error('storage unavailable');
      },
    };

    expect(loadReaderTheme(unavailableStorage)).toBe('dark');
    expect(() => saveReaderTheme(unavailableStorage, 'light')).not.toThrow();
  });

  it('uses a deeper ink green accent for night mode instead of blue', () => {
    const css = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../src/renderer/features/reader/ReaderPage.css',
      ),
      'utf8',
    );
    const dayModeStart = css.indexOf('.reader-page[data-theme="light"] {');
    const nightMode = css.slice(0, dayModeStart);

    expect(nightMode).toContain('--reader-accent: #4b7466;');
    expect(nightMode).toContain('--reader-accent-strong: #668f80;');
    expect(nightMode).toContain('--reader-accent-ink: #0f211a;');
    expect(nightMode).not.toMatch(/#45a7ff|#75c1ff|69,\s*167,\s*255/i);
  });

  it('uses a graduated green editorial palette for day mode', () => {
    const css = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../src/renderer/features/reader/ReaderPage.css',
      ),
      'utf8',
    );
    const dayModeStart = css.indexOf('.reader-page[data-theme="light"] {');
    const dayMode = css.slice(dayModeStart);

    expect(dayModeStart).toBeGreaterThanOrEqual(0);
    expect(dayMode).toContain('--reader-sidebar: #383c3a;');
    expect(dayMode).toContain(
      '--reader-sidebar-active: rgba(142, 183, 168, 0.16);',
    );
    expect(dayMode).toContain('--reader-sidebar-text: #f2f3ef;');
    expect(dayMode).toContain('--reader-sidebar-text-soft: #c4ccc7;');
    expect(dayMode).toContain('--reader-panel: #e8e3d6;');
    expect(dayMode).toContain('--reader-bg: #f3eee2;');
    expect(dayMode).toContain('--reader-text: #3f4541;');
    expect(dayMode).toContain('--reader-text-soft: #666c67;');
    expect(dayMode).toContain('--reader-accent: #5f7d72;');
    expect(dayMode).toContain('background: var(--reader-sidebar);');
    expect(dayMode).toContain(
      'linear-gradient(180deg, #ebe7dc 0%, var(--reader-panel) 52%, #e5dfd2 100%)',
    );
    expect(dayMode).toContain(
      'linear-gradient(180deg, #f6f2e8 0%, var(--reader-bg) 100%)',
    );
    expect(dayMode).toContain(
      '[data-theme="light"].is-sidebar-closed .reader-titlebar',
    );
    expect(dayMode).not.toContain('#cbdad1');
    expect(dayMode).not.toContain('#39443f');
    expect(dayMode).not.toContain('#303733');
    expect(dayMode).not.toContain('#252a28');
    expect(dayMode).not.toMatch(/#d97706|#b45309|217,\s*119,\s*6/i);
  });

  it('keeps the day-mode sidebar toggle light when open and ink green when closed', () => {
    const css = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../src/renderer/features/reader/ReaderPage.css',
      ),
      'utf8',
    );
    const dom = new JSDOM(`
      <style>${css}</style>
      <div class="reader-page is-sidebar-open" data-theme="light">
        <header class="reader-titlebar">
          <button class="icon-button sidebar-toggle"></button>
        </header>
      </div>
    `);
    const page = dom.window.document.querySelector<HTMLElement>('.reader-page');
    const toggle = dom.window.document.querySelector<HTMLElement>('.sidebar-toggle');

    if (!page || !toggle) throw new Error('Sidebar toggle fixture did not render');
    expect(
      dom.window.getComputedStyle(page)
        .getPropertyValue('--reader-sidebar-text')
        .trim(),
    ).toBe('#f2f3ef');
    expect(dom.window.getComputedStyle(toggle).color)
      .toBe('var(--reader-sidebar-text)');

    page.className = 'reader-page is-sidebar-closed';

    expect(
      dom.window.getComputedStyle(page)
        .getPropertyValue('--reader-text')
        .trim(),
    ).toBe('#3f4541');
    expect(dom.window.getComputedStyle(toggle).color).toBe('var(--reader-text)');
  });

  it('keeps active Summary and Translation icons dark on a raised background', () => {
    const css = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../src/renderer/features/reader/ReaderPage.css',
      ),
      'utf8',
    );
    const dom = new JSDOM(`
      <style>${css}</style>
      <div class="reader-page" data-theme="light">
        <div class="entry-detail-ai-actions">
          <button class="is-active" disabled></button>
        </div>
      </div>
    `);
    const button = dom.window.document.querySelector<HTMLElement>('button');

    if (!button) throw new Error('AI action fixture did not render');
    const style = dom.window.getComputedStyle(button);
    expect(style.color).toBe('var(--reader-text)');
    expect(style.background).toBe('var(--reader-panel-raised)');
    expect(style.opacity).toBe('1');
  });
});
