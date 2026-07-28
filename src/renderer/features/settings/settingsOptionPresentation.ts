export const SETTINGS_OPTION_PREVIEW_LIMIT = 10;

export const formatSettingsAuthor = (
  author: string,
  origin: 'builtin' | 'user',
): string => {
  const normalizedAuthor = author.trim().replace(/^@+/, '');
  if (normalizedAuthor) return `@${normalizedAuthor}`;
  return origin === 'builtin' ? '@Shale' : '@我';
};
