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

// ── Tag Search Query Parsing ──────────────────────────────

export interface TagSearchResult {
  /** The remaining text query with `tag:` parts removed. */
  textQuery: string;
  /** Tag names for fuzzy matching (`tag:keyword` → LIKE '%keyword%'). */
  tagFuzzyNames: string[];
  /** Tag names for exact matching (`tag:"Exact Name"` → equality). */
  tagExactNames: string[];
}

/**
 * Parse `tag:keyword` (fuzzy) and `tag:"Exact Name"` (exact) terms from a
 * search query. Returns the cleaned text query and extracted tag names.
 *
 * Examples:
 *   `tag:tech database`       → { textQuery: "database", tagFuzzyNames: ["tech"], tagExactNames: [] }
 *   `tag:"Machine Learning"`  → { textQuery: "", tagFuzzyNames: [], tagExactNames: ["Machine Learning"] }
 *   `tag:tech tag:News`       → { textQuery: "", tagFuzzyNames: ["tech", "News"], tagExactNames: [] }
 */
export const parseTagSearchQuery = (query: string): TagSearchResult => {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return { textQuery: '', tagFuzzyNames: [], tagExactNames: [] };
  }

  const tagFuzzyNames: string[] = [];
  const tagExactNames: string[] = [];
  const textParts: string[] = [];
  let current = '';
  let inQuotes = false;

  const pushCurrent = (): void => {
    const trimmed = current.trim();
    current = '';
    if (!trimmed) return;

    if (trimmed.startsWith('tag:')) {
      const tagValue = trimmed.slice(4);
      if (tagValue) {
        tagFuzzyNames.push(tagValue);
      }
    } else {
      textParts.push(trimmed);
    }
  };

  for (const character of normalized) {
    if (character === '"') {
      if (inQuotes) {
        // Closing quote: the entire quoted section is in current.
        // Check if it started with tag: (i.e., we saw tag:" before the quote).
        const trimmed = current.trim();
        current = '';
        inQuotes = false;

        if (trimmed.startsWith('tag:')) {
          const tagValue = trimmed.slice(4);
          if (tagValue) {
            tagExactNames.push(tagValue);
          }
        } else {
          textParts.push(`"${trimmed}"`);
        }
      } else {
        // Opening quote: push any accumulated text that came before the quote.
        // If current ends with "tag:", strip it and remember we saw a tag:" pattern.
        const trimmed = current.trim();
        current = '';
        inQuotes = true;

        if (trimmed.endsWith('tag:')) {
          // The tag: prefix goes into current so when we close quotes,
          // current will be "tag:Machine Learning"
          current = 'tag:';
        } else if (trimmed) {
          textParts.push(trimmed);
        }
      }
      continue;
    }

    if (!inQuotes && /\s/u.test(character)) {
      pushCurrent();
      continue;
    }

    current += character;
  }

  if (inQuotes) {
    // Unterminated quote: treat as part of the text query
    textParts.push(`"${current.trim()}"`);
  } else {
    pushCurrent();
  }

  return {
    textQuery: textParts.join(' '),
    tagFuzzyNames,
    tagExactNames,
  };
};
