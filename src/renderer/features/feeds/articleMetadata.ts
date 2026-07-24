const HAN_CHARACTER_PATTERN = /\p{Script=Han}/gu;
const LATIN_CHARACTER_PATTERN = /\p{Script=Latin}/gu;

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function isPredominantlyChinese(value: string, minimumHanCharacters: number): boolean {
  const hanCharacterCount = countMatches(value, HAN_CHARACTER_PATTERN);
  const latinCharacterCount = countMatches(value, LATIN_CHARACTER_PATTERN);

  return hanCharacterCount >= minimumHanCharacters
    && hanCharacterCount >= latinCharacterCount * 0.2;
}

export function getArticleDateLocale(title?: string, body?: string): 'en-US' | 'zh-CN' {
  if (title && isPredominantlyChinese(title, 2)) {
    return 'zh-CN';
  }

  return body && isPredominantlyChinese(body.slice(0, 2_000), 6)
    ? 'zh-CN'
    : 'en-US';
}

export function formatArticleDate(value: string, locale: 'en-US' | 'zh-CN'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}
