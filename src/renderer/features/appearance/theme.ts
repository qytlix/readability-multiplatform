export type ReaderTheme = 'dark' | 'light';

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const READER_THEME_STORAGE_KEY = 'shale.reader-theme';
export const DEFAULT_READER_THEME: ReaderTheme = 'dark';

export const loadReaderTheme = (storage: ThemeStorage): ReaderTheme => {
  try {
    const savedTheme = storage.getItem(READER_THEME_STORAGE_KEY);
    return savedTheme === 'light' || savedTheme === 'dark'
      ? savedTheme
      : DEFAULT_READER_THEME;
  } catch {
    return DEFAULT_READER_THEME;
  }
};

export const saveReaderTheme = (
  storage: ThemeStorage,
  theme: ReaderTheme,
): void => {
  try {
    storage.setItem(READER_THEME_STORAGE_KEY, theme);
  } catch {
    // The selected theme still applies for this session when storage is unavailable.
  }
};
