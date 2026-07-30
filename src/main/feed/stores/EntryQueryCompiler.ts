import type {
  EntryQuery,
  FilterField,
  SearchFilter,
} from '../../../shared/contracts/feed.types';

export interface CompiledEntryQueryScope {
  conditions: string[];
  parameters: unknown[];
}

const ALLOWED_FILTER_FIELDS: readonly FilterField[] = [
  'tag', 'feed', 'title', 'content', 'author', 'starred', 'read',
];

export function compileEntryQueryScope(
  options: EntryQuery,
): CompiledEntryQueryScope {
  validateEntryQuery(options);
  const conditions: string[] = [];
  const parameters: unknown[] = [];

  if (options.feedId !== undefined) {
    conditions.push('e.feedId = ?');
    parameters.push(options.feedId);
  }
  if (options.isRead !== undefined) {
    conditions.push('e.isRead = ?');
    parameters.push(options.isRead ? 1 : 0);
  }
  if (options.isStarred !== undefined) {
    conditions.push('e.isStarred = ?');
    parameters.push(options.isStarred ? 1 : 0);
  }

  appendStructuredFilters(options.filters, conditions, parameters);
  return { conditions, parameters };
}

export function escapeLikePattern(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

function validateEntryQuery(options: EntryQuery): void {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new RangeError('Entry query limit must be between 1 and 100.');
  }
  if (
    options.feedId !== undefined
    && (!Number.isInteger(options.feedId) || options.feedId <= 0)
  ) {
    throw new RangeError('Entry query feedId must be a positive integer.');
  }
  if (options.search !== undefined && options.search.length > 256) {
    throw new RangeError('Entry search query must not exceed 256 characters.');
  }
  if (options.filters !== undefined) {
    if (!Array.isArray(options.filters) || options.filters.length > 50) {
      throw new RangeError('Entry query filters must be an array of up to 50 entries.');
    }
    for (const filter of options.filters) {
      if (
        typeof filter !== 'object'
        || filter === null
        || !ALLOWED_FILTER_FIELDS.includes(filter.field)
      ) {
        throw new RangeError('Entry query filter field is invalid.');
      }
      if (typeof filter.value !== 'string' || filter.value.length > 100) {
        throw new RangeError('Filter value must be a string up to 100 characters.');
      }
      if (filter.operator !== '+' && filter.operator !== '-' && filter.operator !== '') {
        throw new RangeError(`Invalid filter operator: "${filter.operator}".`);
      }
      if (
        filter.match !== undefined
        && filter.match !== 'fuzzy'
        && filter.match !== 'exact'
      ) {
        throw new RangeError(`Invalid filter match mode: "${filter.match}".`);
      }
    }
  }
  if (
    options.cursor
    && (
      !options.cursor.publishedAt
      || !Number.isInteger(options.cursor.id)
      || options.cursor.id <= 0
    )
  ) {
    throw new RangeError('Entry query cursor is invalid.');
  }
}

function appendStructuredFilters(
  filters: SearchFilter[] | undefined,
  conditions: string[],
  parameters: unknown[],
): void {
  if (!filters || filters.length === 0) return;

  const escapeClause = " ESCAPE '\\'";
  const orGroups = new Map<FilterField, string[]>();
  const tagFuzzyOrValues: string[] = [];
  const tagExactOrValues: string[] = [];

  for (const filter of filters) {
    if (filter.operator === '') {
      if (filter.field === 'tag' && filter.match === 'exact') {
        tagExactOrValues.push(filter.value);
      } else if (filter.field === 'tag') {
        tagFuzzyOrValues.push(filter.value);
      } else {
        const group = orGroups.get(filter.field) || [];
        group.push(filter.value);
        orGroups.set(filter.field, group);
      }
    } else {
      appendSingleFilter(filter, conditions, parameters, escapeClause);
    }
  }

  for (const [field, values] of orGroups) {
    appendOrGroupFilter(field, values, conditions, parameters, escapeClause);
  }
  if (tagFuzzyOrValues.length > 0) {
    appendTagOrGroup(
      'fuzzy',
      tagFuzzyOrValues,
      conditions,
      parameters,
      escapeClause,
    );
  }
  if (tagExactOrValues.length > 0) {
    appendTagOrGroup(
      'exact',
      tagExactOrValues,
      conditions,
      parameters,
      escapeClause,
    );
  }
}

function appendSingleFilter(
  filter: SearchFilter,
  conditions: string[],
  parameters: unknown[],
  escapeClause: string,
): void {
  const { field, operator, value, match } = filter;

  switch (field) {
    case 'tag': {
      const exact = match === 'exact';
      if (operator === '-') {
        conditions.push(`NOT EXISTS (
          SELECT 1 FROM entry_tag et
          JOIN tag t ON t.id = et.tagId
          WHERE et.entryId = e.id AND t.name ${exact ? '= ?' : `LIKE ?${escapeClause}`}
        )`);
        parameters.push(exact ? value : `%${escapeLikePattern(value)}%`);
      } else {
        conditions.push(`e.id IN (
          SELECT et.entryId FROM entry_tag et
          JOIN tag t ON t.id = et.tagId
          WHERE t.name ${exact ? '= ?' : `LIKE ?${escapeClause}`}
        )`);
        parameters.push(exact ? value : `%${escapeLikePattern(value)}%`);
      }
      break;
    }
    case 'feed': {
      conditions.push(operator === '-'
        ? `COALESCE(search_normalize(f.title), '') NOT LIKE ?${escapeClause}`
        : `search_normalize(f.title) LIKE ?${escapeClause}`);
      parameters.push(`%${escapeLikePattern(value)}%`);
      break;
    }
    case 'title': {
      conditions.push(operator === '-'
        ? `COALESCE(search_normalize(e.title), '') NOT LIKE ?${escapeClause}`
        : `search_normalize(e.title) LIKE ?${escapeClause}`);
      parameters.push(`%${escapeLikePattern(value)}%`);
      break;
    }
    case 'content': {
      conditions.push(operator === '-'
        ? `(ec.markdown IS NULL OR search_normalize(ec.markdown) NOT LIKE ?${escapeClause})`
        : `search_normalize(ec.markdown) LIKE ?${escapeClause}`);
      parameters.push(`%${escapeLikePattern(value)}%`);
      break;
    }
    case 'author': {
      conditions.push(operator === '-'
        ? `(e.author IS NULL OR search_normalize(e.author) NOT LIKE ?${escapeClause})`
        : `search_normalize(e.author) LIKE ?${escapeClause}`);
      parameters.push(`%${escapeLikePattern(value)}%`);
      break;
    }
    case 'starred': {
      const boolVal = parseBooleanFilterValue(value);
      if (boolVal === undefined) {
        conditions.push('0 = 1');
        break;
      }
      conditions.push(`e.isStarred ${operator === '-' ? '!=' : '='} ?`);
      parameters.push(boolVal);
      break;
    }
    case 'read': {
      const boolVal = parseBooleanFilterValue(value);
      if (boolVal === undefined) {
        conditions.push('0 = 1');
        break;
      }
      conditions.push(`e.isRead ${operator === '-' ? '!=' : '='} ?`);
      parameters.push(boolVal);
      break;
    }
  }
}

function appendTagOrGroup(
  mode: 'fuzzy' | 'exact',
  values: string[],
  conditions: string[],
  parameters: unknown[],
  escapeClause: string,
): void {
  const subConditions = values.map(() =>
    mode === 'exact' ? 't.name = ?' : `t.name LIKE ?${escapeClause}`
  );
  const likeParameters = values.map((value) =>
    mode === 'exact' ? value : `%${escapeLikePattern(value)}%`
  );
  conditions.push(
    `e.id IN (
      SELECT et.entryId FROM entry_tag et
      JOIN tag t ON t.id = et.tagId
      WHERE ${subConditions.join(' OR ')}
    )`,
  );
  parameters.push(...likeParameters);
}

function appendOrGroupFilter(
  field: FilterField,
  values: string[],
  conditions: string[],
  parameters: unknown[],
  escapeClause: string,
): void {
  switch (field) {
    case 'tag': {
      const subConditions = values.map(() => `t.name LIKE ?${escapeClause}`);
      const likeParameters = values.map((value) => `%${escapeLikePattern(value)}%`);
      conditions.push(
        `e.id IN (
          SELECT et.entryId FROM entry_tag et
          JOIN tag t ON t.id = et.tagId
          WHERE ${subConditions.join(' OR ')}
        )`,
      );
      parameters.push(...likeParameters);
      break;
    }
    case 'feed': {
      const subConditions = values.map(
        () => `search_normalize(f.title) LIKE ?${escapeClause}`,
      );
      conditions.push(`(${subConditions.join(' OR ')})`);
      parameters.push(...values.map((value) => `%${escapeLikePattern(value)}%`));
      break;
    }
    case 'title': {
      const subConditions = values.map(
        () => `search_normalize(e.title) LIKE ?${escapeClause}`,
      );
      conditions.push(`(${subConditions.join(' OR ')})`);
      parameters.push(...values.map((value) => `%${escapeLikePattern(value)}%`));
      break;
    }
    case 'content': {
      const subConditions = values.map(
        () => `search_normalize(ec.markdown) LIKE ?${escapeClause}`,
      );
      conditions.push(`(${subConditions.join(' OR ')})`);
      parameters.push(...values.map((value) => `%${escapeLikePattern(value)}%`));
      break;
    }
    case 'author': {
      const subConditions = values.map(
        () => `search_normalize(e.author) LIKE ?${escapeClause}`,
      );
      conditions.push(`(${subConditions.join(' OR ')})`);
      parameters.push(...values.map((value) => `%${escapeLikePattern(value)}%`));
      break;
    }
    case 'starred':
    case 'read': {
      const booleanValues = Array.from(new Set(
        values
          .map(parseBooleanFilterValue)
          .filter((value): value is number => value !== undefined),
      ));
      if (booleanValues.length === 0) {
        conditions.push('0 = 1');
        break;
      }
      const column = field === 'starred' ? 'e.isStarred' : 'e.isRead';
      conditions.push(`${column} IN (${booleanValues.map(() => '?').join(', ')})`);
      parameters.push(...booleanValues);
      break;
    }
  }
}

function parseBooleanFilterValue(value: string): number | undefined {
  const normalized = value.toLocaleLowerCase();
  if (normalized === 'yes' || normalized === '1') return 1;
  if (normalized === 'no' || normalized === '0') return 0;
  return undefined;
}
