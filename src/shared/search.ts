export interface ParsedSearchTerm {
  value: string;
  isPhrase: boolean;
}

export const normalizeSearchQuery = (query: string): string =>
  query.normalize('NFKC').trim().replace(/\s+/gu, ' ');

/**
 * Parse user text without exposing FTS5 operators. Quoted text is kept as one
 * phrase; all other whitespace-delimited values become independent AND terms.
 */
export const parseSearchTerms = (query: string): ParsedSearchTerm[] => {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return [];

  const terms: ParsedSearchTerm[] = [];
  let current = '';
  let inQuotes = false;

  const pushCurrent = (isPhrase: boolean): void => {
    const value = normalizeSearchQuery(current);
    current = '';
    if (!value) return;
    terms.push({ value, isPhrase });
  };

  for (const character of normalized) {
    if (character === '"') {
      if (inQuotes) {
        pushCurrent(true);
        inQuotes = false;
      } else {
        pushCurrent(false);
        inQuotes = true;
      }
      continue;
    }

    if (!inQuotes && /\s/u.test(character)) {
      pushCurrent(false);
      continue;
    }

    current += character;
  }

  pushCurrent(inQuotes);
  return terms;
};

export const getPlainSearchText = (terms: ParsedSearchTerm[]): string =>
  terms.map((term) => term.value).join(' ');

export const requiresShortSearchFallback = (
  terms: ParsedSearchTerm[],
): boolean => terms.some((term) => Array.from(term.value).length < 3);

export const toFts5Query = (terms: ParsedSearchTerm[]): string =>
  terms
    .map((term) => `"${term.value.replace(/"/g, '""')}"`)
    .join(' AND ');
