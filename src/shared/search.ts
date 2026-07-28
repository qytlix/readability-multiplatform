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

// ── Generic Search Query Parsing ──────────────────────────

export type FilterField =
  | 'tag' | 'feed' | 'title' | 'content' | 'author'
  | 'starred' | 'read';

export type FilterOperator = '+' | '-' | '';

export interface SearchFilter {
  field: FilterField;
  operator: FilterOperator;
  value: string;
}

export interface ParsedSearchQuery {
  /** The remaining text query with all `field:`, `+field:`, `-field:` parts removed. */
  textQuery: string;
  /** Structured field filters extracted from the query. */
  filters: SearchFilter[];
  /** Backward compat: tag names for fuzzy matching (`tag:keyword` → LIKE '%keyword%'), OR semantics. */
  tagAnyFuzzy: string[];
  /** Backward compat: tag names for exact matching (`tag:"Exact Name"` → equality), OR semantics. */
  tagAnyExact: string[];
}

const FILTER_FIELDS = new Set<FilterField>([
  'tag', 'feed', 'title', 'content', 'author', 'starred', 'read',
]);

/**
 * Parse a search query into plain text and structured field filters.
 *
 * Supported syntax:
 *   `field:value`       → OR inclusion
 *   `+field:value`      → AND inclusion (must have)
 *   `-field:value`      → exclusion
 *   `field:"quoted"`    → value with spaces
 *   `"plain phrase"`    → quoted phrase in textQuery
 *
 * Supported fields: tag, feed, title, content, author, starred, read
 *
 * Examples:
 *   `tag:tech database`
 *     → { textQuery: "database", filters: [{ field:'tag', op:'', value:'tech' }] }
 *   `+tag:tech -tag:news starred:yes`
 *     → { textQuery: "", filters: [
 *         { field:'tag', op:'+', value:'tech' },
 *         { field:'tag', op:'-', value:'news' },
 *         { field:'starred', op:'', value:'yes' },
 *       ]}
 */
export const parseSearchQuery = (query: string): ParsedSearchQuery => {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return { textQuery: '', filters: [], tagAnyFuzzy: [], tagAnyExact: [] };
  }

  const filters: SearchFilter[] = [];
  const textParts: string[] = [];
  const tagAnyFuzzy: string[] = [];
  const tagAnyExact: string[] = [];
  let current = '';
  let inQuotes = false;
  /** When we see `tag:"` or `+feed:"`, the prefix is saved here until closing quote. */
  let filterPrefixInQuotes = '';

  /** Pattern to detect `[+-]?fieldname:` at end of current (right before an opening quote). */
  const prefixRe = /^([+-])?(\w+):$/;

  /**
   * Pattern to detect `[+-]?fieldname:` with nothing after (dangling filter).
   * Old behavior: silently dropped.
   */
  const danglingFilterRe = /^([+-])?(\w+):$/;
  /** Pattern to detect `[+-]?fieldname:value` in a complete token. */
  const filterRe = /^([+-])?(\w+):(.+)$/s;

  const handleToken = (token: string): void => {
    if (!token) return;

    // Dangling filter prefix like `tag:` or `+feed:` with no value — silently drop (backward compat)
    const danglingMatch = token.match(danglingFilterRe);
    if (danglingMatch && FILTER_FIELDS.has(danglingMatch[2] as FilterField)) {
      return;
    }

    const match = token.match(filterRe);
    if (match && FILTER_FIELDS.has(match[2] as FilterField)) {
      const operator = (match[1] || '') as FilterOperator;
      const field = match[2] as FilterField;
      const value = match[3];
      if (value) {
        filters.push({ field, operator, value });
        // Backward compat: populate tagAnyFuzzy/tagAnyExact for operator==='' tag filters
        if (field === 'tag' && operator === '') {
          (value.includes('"') ? tagAnyExact : tagAnyFuzzy).push(value.replace(/"/g, ''));
        }
      }
    } else {
      textParts.push(token);
    }
  };

  for (const character of normalized) {
    if (character === '"') {
      if (inQuotes) {
        // Closing quote
        inQuotes = false;
        const trimmed = current.trim();
        current = '';

        if (filterPrefixInQuotes) {
          // This was [+-]field:"value"
          const prefix = filterPrefixInQuotes;
          filterPrefixInQuotes = '';
          const preMatch = prefix.match(prefixRe);
          if (preMatch && trimmed) {
            const operator = (preMatch[1] || '') as FilterOperator;
            const field = preMatch[2] as FilterField;
            filters.push({ field, operator, value: trimmed });
            // Backward compat: tag: with empty operator → exact
            if (field === 'tag' && operator === '') {
              tagAnyExact.push(trimmed);
            }
          }
        } else {
          // Non-filter quoted text: preserve as quoted phrase
          if (trimmed) {
            textParts.push(`"${trimmed}"`);
          }
        }
      } else {
        // Opening quote
        const trimmed = current.trim();
        current = '';
        inQuotes = true;
        filterPrefixInQuotes = '';

        if (prefixRe.test(trimmed)) {
          // This is [+-]field:" — save prefix, value comes inside quotes
          filterPrefixInQuotes = trimmed;
        } else if (trimmed) {
          textParts.push(trimmed);
        }
      }
      continue;
    }

    if (!inQuotes && /\s/u.test(character)) {
      handleToken(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  // End of input
  if (inQuotes) {
    // Unterminated quote: treat as part of the text query
    const content = current.trim();
    if (filterPrefixInQuotes) {
      textParts.push(`"${filterPrefixInQuotes}${content}"`);
    } else {
      textParts.push(`"${content}"`);
    }
  } else {
    handleToken(current.trim());
  }

  return {
    textQuery: textParts.join(' '),
    filters,
    tagAnyFuzzy,
    tagAnyExact,
  };
};

// ── Tag Search Query Parsing (backward compat wrapper) ───

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
 * This is a backward-compatible wrapper around {@link parseSearchQuery}.
 *
 * Examples:
 *   `tag:tech database`       → { textQuery: "database", tagFuzzyNames: ["tech"], tagExactNames: [] }
 *   `tag:"Machine Learning"`  → { textQuery: "", tagFuzzyNames: [], tagExactNames: ["Machine Learning"] }
 *   `tag:tech tag:News`       → { textQuery: "", tagFuzzyNames: ["tech", "News"], tagExactNames: [] }
 */
export const parseTagSearchQuery = (query: string): TagSearchResult => {
  const parsed = parseSearchQuery(query);
  return {
    textQuery: parsed.textQuery,
    tagFuzzyNames: parsed.tagAnyFuzzy,
    tagExactNames: parsed.tagAnyExact,
  };
};
