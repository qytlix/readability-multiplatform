import { describe, expect, it } from 'vitest';
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
});
