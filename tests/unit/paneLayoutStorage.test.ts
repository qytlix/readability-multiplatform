import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDefaultPaneLayoutPreference,
  parseStoredPaneLayoutPreference,
  toStoredPaneLayoutPreference,
} from '../../src/renderer/features/layout/paneLayout';
import {
  PANE_LAYOUT_STORAGE_KEY,
  loadPaneLayoutPreference,
  savePaneLayoutPreference,
} from '../../src/renderer/features/layout/paneLayoutStorage';

interface MemoryStorage {
  getItem: ReturnType<typeof vi.fn<(key: string) => string | null>>;
  setItem: ReturnType<typeof vi.fn<(key: string, value: string) => void>>;
}

const createMemoryStorage = (initialValue: string | null): MemoryStorage => {
  let value = initialValue;

  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, nextValue: string) => {
      value = nextValue;
    }),
  };
};

const installStorage = (storage: MemoryStorage): void => {
  vi.stubGlobal('window', { localStorage: storage });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pane layout storage', () => {
  it('uses the default preference when there is no stored value', () => {
    const storage = createMemoryStorage(null);
    installStorage(storage);

    expect(loadPaneLayoutPreference()).toEqual(getDefaultPaneLayoutPreference());
    expect(storage.getItem).toHaveBeenCalledWith(PANE_LAYOUT_STORAGE_KEY);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('loads a valid v2 preference without rewriting it', () => {
    const storedPreference = {
      version: 2,
      feed: { width: 280, collapsed: true },
      entry: { width: 440, collapsed: false },
    };
    const storage = createMemoryStorage(JSON.stringify(storedPreference));
    installStorage(storage);

    expect(loadPaneLayoutPreference()).toEqual({
      version: 2,
      feed: { preferredWidth: 280, collapsed: true },
      entry: { preferredWidth: 440, collapsed: false },
    });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('migrates v1 and writes the normalized v2 preference back to storage', () => {
    const storage = createMemoryStorage('{"version":1,"feedWidth":300,"entryWidth":500}');
    installStorage(storage);

    const preference = loadPaneLayoutPreference();

    expect(preference).toEqual({
      version: 2,
      feed: { preferredWidth: 300, collapsed: false },
      entry: { preferredWidth: 500, collapsed: false },
    });
    expect(storage.setItem).toHaveBeenCalledWith(
      PANE_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        feed: { width: 300, collapsed: false },
        entry: { width: 500, collapsed: false },
      }),
    );
  });

  it.each([
    ['damaged JSON', '{not json'],
    ['an unknown version', '{"version":3,"feedWidth":280,"entryWidth":440}'],
    ['an invalid v2 width', '{"version":2,"feed":{"width":null,"collapsed":false},"entry":{"width":440,"collapsed":false}}'],
  ])('falls back to defaults for %s', (_description, rawValue) => {
    const storage = createMemoryStorage(rawValue);
    installStorage(storage);

    expect(loadPaneLayoutPreference()).toEqual(getDefaultPaneLayoutPreference());
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('maps the domain preferred width to and from the unchanged v2 stored width field', () => {
    const preference = {
      version: 2,
      feed: { preferredWidth: 340, collapsed: false },
      entry: { preferredWidth: 560, collapsed: true },
    };
    const storedPreference = toStoredPaneLayoutPreference(preference);
    const rawValue = JSON.stringify(storedPreference);

    expect(storedPreference).toEqual({
      version: 2,
      feed: { width: 340, collapsed: false },
      entry: { width: 560, collapsed: true },
    });
    expect(rawValue).not.toContain('preferredWidth');
    expect(parseStoredPaneLayoutPreference(rawValue)).toEqual(preference);
  });

  it('saves the normalized preference under the layout storage key', () => {
    const storage = createMemoryStorage(null);
    installStorage(storage);
    const preference = getDefaultPaneLayoutPreference();

    savePaneLayoutPreference(preference);

    expect(storage.setItem).toHaveBeenCalledWith(
      PANE_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        feed: { width: 224, collapsed: false },
        entry: { width: 400, collapsed: false },
      }),
    );
  });

  it('does not throw when saving fails', () => {
    const storage = createMemoryStorage(null);
    storage.setItem.mockImplementation(() => {
      throw new Error('storage is full');
    });
    installStorage(storage);

    expect(() => savePaneLayoutPreference(getDefaultPaneLayoutPreference())).not.toThrow();
    expect(storage.setItem).toHaveBeenCalledWith(
      PANE_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        feed: { width: 224, collapsed: false },
        entry: { width: 400, collapsed: false },
      }),
    );
  });

  it('uses defaults and does not throw when localStorage is unavailable', () => {
    vi.stubGlobal('window', {});

    expect(loadPaneLayoutPreference()).toEqual(getDefaultPaneLayoutPreference());
    expect(() => savePaneLayoutPreference(getDefaultPaneLayoutPreference())).not.toThrow();
  });
});
