import { describe, expect, it } from 'vitest';
import {
  DEFAULT_READER_PREFERENCES,
  loadReaderPreferences,
  READER_PREFERENCES_STORAGE_KEY,
  saveReaderPreferences,
} from '../../../src/renderer/features/settings/readerPreferences';

const createStorage = (initialValue: string | null = null) => {
  let value = initialValue;
  return {
    getItem: (key: string) =>
      key === READER_PREFERENCES_STORAGE_KEY ? value : null,
    setItem: (key: string, nextValue: string) => {
      if (key === READER_PREFERENCES_STORAGE_KEY) value = nextValue;
    },
    read: () => value,
  };
};

describe('reader preferences', () => {
  it('enables page-turn animation by default', () => {
    expect(loadReaderPreferences(createStorage()))
      .toEqual(DEFAULT_READER_PREFERENCES);
  });

  it('restores and persists the page-turn animation setting', () => {
    const storage = createStorage();

    saveReaderPreferences(storage, { pageTurnAnimationEnabled: false });

    expect(storage.read()).toBe('{"pageTurnAnimationEnabled":false}');
    expect(loadReaderPreferences(storage)).toEqual({
      pageTurnAnimationEnabled: false,
    });
  });

  it('falls back safely for invalid or unavailable storage', () => {
    expect(loadReaderPreferences(createStorage('{"pageTurnAnimationEnabled":"no"}')))
      .toEqual(DEFAULT_READER_PREFERENCES);

    const unavailableStorage = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: () => {
        throw new Error('storage unavailable');
      },
    };

    expect(loadReaderPreferences(unavailableStorage))
      .toEqual(DEFAULT_READER_PREFERENCES);
    expect(() => saveReaderPreferences(
      unavailableStorage,
      { pageTurnAnimationEnabled: false },
    )).not.toThrow();
  });
});
