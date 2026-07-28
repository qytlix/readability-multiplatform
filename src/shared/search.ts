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
  /**
   * Match mode for tag field.
   * - `'fuzzy'` or omitted → LIKE with %% (default, for `tag:` syntax)
   * - `'exact'` → equality (for `tag=` syntax)
   * Ignored for non-tag fields.
   */
  match?: 'fuzzy' | 'exact';
}

export interface ParsedSearchQuery {
  /** The remaining text query with all `field:`, `+field:`, `-field:` parts removed. */
  textQuery: string;
  /** Structured field filters extracted from the query. */
  filters: SearchFilter[];
}

const FILTER_FIELDS = new Set<FilterField>([
  'tag', 'feed', 'title', 'content', 'author', 'starred', 'read',
]);

/**
 * Parse a search query into plain text and structured field filters.
 *
 * Supported syntax:
 *   `field:value`       → OR inclusion (fuzzy for tag)
 *   `field=value`       → OR inclusion, exact match (tag only)
 *   `+field:value`      → AND inclusion (must have)
 *   `-field:value`      → exclusion
 *   `field:"quoted"`    → value with spaces
 *   `"plain phrase"`    → quoted phrase in textQuery
 *
 * Supported fields: tag, feed, title, content, author, starred, read
 *
 * Examples:
 *   `tag:tech database`
 *     → { textQuery: "database", filters: [{ field:'tag', op:'', value:'tech', match:'fuzzy' }] }
 *   `tag=tech database`
 *     → { textQuery: "database", filters: [{ field:'tag', op:'', value:'tech', match:'exact' }] }
 *   `+tag:tech -tag:news starred:yes`
 *     → { textQuery: "", filters: [
 *         { field:'tag', op:'+', value:'tech', match:'fuzzy' },
 *         { field:'tag', op:'-', value:'news', match:'fuzzy' },
 *         { field:'starred', op:'', value:'yes' },
 *       ]}
 */
export const parseSearchQuery = (query: string): ParsedSearchQuery => {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return { textQuery: '', filters: [] };
  }

  const filters: SearchFilter[] = [];
  const textParts: string[] = [];
  let current = '';
  let inQuotes = false;
  /** When we see `tag:"` or `+feed:"`, the prefix is saved here until closing quote. */
  let filterPrefixInQuotes = '';

  /**
   * Detect `[+-]?fieldname:` (colon) or `[+-]?fieldname=` (equals) at end of
   * current buffer (right before an opening quote).
   */
  const prefixRe = /^([+-])?(\w+)[:=]$/;

  /** Dangling `[+-]?field:` or `[+-]?field=` with no value — silently dropped. */
  const danglingRe = /^([+-])?(\w+)[:=]$/;
  /** Detect `[+-]?fieldname:value` or `[+-]?fieldname=value` in a complete token. */
  const filterRe = /^([+-])?(\w+)([:=])(.+)$/s;

  const handleToken = (token: string): void => {
    if (!token) return;

    // Dangling filter prefix like `tag:` or `tag=` with no value — silently drop
    const danglingMatch = token.match(danglingRe);
    if (danglingMatch && FILTER_FIELDS.has(danglingMatch[2] as FilterField)) {
      return;
    }

    const match = token.match(filterRe);
    if (match && FILTER_FIELDS.has(match[2] as FilterField)) {
      const operator = (match[1] || '') as FilterOperator;
      const field = match[2] as FilterField;
      const separator = match[3]; // ':' or '='
      const value = match[4];
      if (value) {
        const filter: SearchFilter = { field, operator, value };
        if (field === 'tag' && separator === '=') {
          filter.match = 'exact';
        } else if (field === 'tag') {
          filter.match = 'fuzzy';
        }
        filters.push(filter);
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
          // 只有受支持的字段才转为过滤器；未知字段完整保留为全文文本。
          const prefix = filterPrefixInQuotes;
          filterPrefixInQuotes = '';
          const preMatch = prefix.match(prefixRe);
          if (
            preMatch
            && trimmed
            && FILTER_FIELDS.has(preMatch[2] as FilterField)
          ) {
            const operator = (preMatch[1] || '') as FilterOperator;
            const field = preMatch[2] as FilterField;
            const separator = prefix.endsWith('=') ? '=' : ':';
            const filter: SearchFilter = { field, operator, value: trimmed };
            if (field === 'tag' && separator === '=') {
              filter.match = 'exact';
            } else if (field === 'tag') {
              filter.match = 'fuzzy';
            }
            filters.push(filter);
          } else if (trimmed) {
            textParts.push(`${prefix}"${trimmed}"`);
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
          // This is [+-]field:" or [+-]field=" — save prefix
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
  };
};
