export interface ReaderPreferences {
  pageTurnAnimationEnabled: boolean;
}

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  pageTurnAnimationEnabled: true,
};

export const READER_PREFERENCES_STORAGE_KEY = 'shale.readerPreferences';

interface PreferenceStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export const loadReaderPreferences = (
  storage: PreferenceStorage,
): ReaderPreferences => {
  try {
    const stored = storage.getItem(READER_PREFERENCES_STORAGE_KEY);
    if (!stored) return DEFAULT_READER_PREFERENCES;

    const candidate = JSON.parse(stored) as Partial<ReaderPreferences>;
    return {
      pageTurnAnimationEnabled:
        typeof candidate.pageTurnAnimationEnabled === 'boolean'
          ? candidate.pageTurnAnimationEnabled
          : DEFAULT_READER_PREFERENCES.pageTurnAnimationEnabled,
    };
  } catch {
    return DEFAULT_READER_PREFERENCES;
  }
};

export const saveReaderPreferences = (
  storage: PreferenceStorage,
  preferences: ReaderPreferences,
): void => {
  try {
    storage.setItem(
      READER_PREFERENCES_STORAGE_KEY,
      JSON.stringify(preferences),
    );
  } catch {
    // The current session can still use the selected preference.
  }
};
