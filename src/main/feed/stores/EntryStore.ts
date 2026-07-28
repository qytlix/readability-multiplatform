import type Database from 'better-sqlite3';
import type {
  Entry,
  EntryCursor,
  EntryListItem,
  EntryQuery,
  EntryReadingProgress,
  EntryReadStats,
  EntryStats,
  FeedEntryReadStats,
  FilterField,
  SearchFilter,
} from '../../../shared/contracts/feed.types';
import type { PipelineStatus } from '../../../shared/contracts/content.types';
import type { Tag } from '../../../shared/contracts/tag.types';
import {
  getPlainSearchText,
  normalizeSearchQuery,
  parseSearchTerms,
  requiresShortSearchFallback,
  toFts5Query,
  type ParsedSearchTerm,
} from '../../../shared/search';

interface UpsertEntryParams {
  feedId: number;
  guid?: string;
  url?: string;
  title?: string;
  author?: string;
  publishedAt?: string;
  summary?: string;
  feedContentHtml?: string;
  contentHash?: string;
}

interface EntryQueryResult {
  entries: EntryListItem[];
  nextCursor?: EntryCursor;
}

export class EntryStore {
  constructor(private db: Database.Database) {}

  /**
   * Upsert an entry by (feedId, guid) or (feedId, url) fallback.
   * Returns { id, isNew } so callers can distinguish insert vs update.
   */
  createOrUpdate(params: UpsertEntryParams): { id: number; isNew: boolean } {
    const now = new Date().toISOString();

    // Try to find existing entry by (feedId, guid)
    let existing: Record<string, unknown> | undefined;
    if (params.guid) {
      existing = this.db
        .prepare('SELECT * FROM entry WHERE feedId = ? AND guid = ?')
        .get(params.feedId, params.guid) as Record<string, unknown> | undefined;
    }

    // Fallback: try by (feedId, url)
    if (!existing && params.url) {
      existing = this.db
        .prepare('SELECT * FROM entry WHERE feedId = ? AND url = ?')
        .get(params.feedId, params.url) as Record<string, unknown> | undefined;
    }

    if (existing) {
      // Don't resurrect tombstone entries
      if (existing.isDeleted) return { id: existing.id as number, isNew: false };

      // Update metadata, but preserve isRead/isStarred
      const stmt = this.db.prepare(`
        UPDATE entry SET
          url = COALESCE(?, url),
          title = COALESCE(?, title),
          author = COALESCE(?, author),
          publishedAt = COALESCE(?, publishedAt),
          summary = COALESCE(?, summary),
          feedContentHtml = COALESCE(?, feedContentHtml),
          contentHash = COALESCE(?, contentHash),
          updatedAt = ?
        WHERE id = ?
      `);

      const existingId = existing.id as number;

      stmt.run(
        params.url ?? null,
        params.title ?? null,
        params.author ?? null,
        params.publishedAt ?? null,
        params.summary ?? null,
        params.feedContentHtml ?? null,
        params.contentHash ?? null,
        now,
        existingId,
      );

      return { id: existingId, isNew: false };
    }

    // Create new entry
    const stmt = this.db.prepare(`
      INSERT INTO entry (
        feedId, guid, url, title, author, publishedAt, summary,
        feedContentHtml, contentHash, createdAt, updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      params.feedId,
      params.guid ?? null,
      params.url ?? null,
      params.title ?? null,
      params.author ?? null,
      params.publishedAt ?? null,
      params.summary ?? null,
      params.feedContentHtml ?? null,
      params.contentHash ?? null,
      now,
      now,
    );

    return { id: result.lastInsertRowid as number, isNew: true };
  }

  findById(id: number): Entry | undefined {
    const row = this.db.prepare('SELECT * FROM entry WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? normalizeEntry(row) : undefined;
  }

  findFeedContentHtml(id: number): string | undefined {
    const row = this.db
      .prepare('SELECT feedContentHtml FROM entry WHERE id = ?')
      .get(id) as { feedContentHtml: string | null } | undefined;
    return row?.feedContentHtml ?? undefined;
  }

  /**
   * Query entries with optional filters and keyset pagination.
   */
  query(options: EntryQuery): EntryQueryResult {
    validateEntryQuery(options);
    const searchTerms = parseSearchTerms(options.search ?? '');
    const result = searchTerms.length > 0
      ? this.querySearch(options, searchTerms)
      : this.queryBrowse(options);

    // Batch-populate tags for all returned entries
    if (result.entries.length > 0) {
      const entryIds = result.entries.map((e) => e.id);
      const tagMap = this.batchTagsByEntry(entryIds);
      for (const entry of result.entries) {
        entry.tags = tagMap.get(entry.id) ?? [];
      }
    }

    return result;
  }

  private queryBrowse(options: EntryQuery): EntryQueryResult {
    const conditions: string[] = ['e.isDeleted = 0'];
    const whereParams: unknown[] = [];
    appendScopeConditions(options, conditions, whereParams);
    if (options.cursor) {
      conditions.push(`(
        COALESCE(e.publishedAt, e.createdAt) < ?
        OR (COALESCE(e.publishedAt, e.createdAt) = ? AND e.id < ?)
      )`);
      whereParams.push(options.cursor.publishedAt, options.cursor.publishedAt, options.cursor.id);
    }

    const limit = options.limit;
    const query = `
      SELECT
        e.*,
        f.title AS feedTitle,
        ec.pipelineStatus,
        COALESCE(e.publishedAt, e.createdAt) AS effectivePublishedAt
      FROM entry e
      LEFT JOIN feed f ON f.id = e.feedId
      LEFT JOIN entry_content ec ON ec.entryId = e.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY effectivePublishedAt DESC, e.id DESC
      LIMIT ?
    `;
    const rows = this.db.prepare(query).all(...whereParams, limit + 1) as Array<
      Record<string, unknown> & { effectivePublishedAt: string }
    >;

    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const entries = rows.map(toEntryListItem);
    const lastRow = hasMore ? rows.at(-1) : undefined;
    const nextCursor = lastRow
      ? { publishedAt: lastRow.effectivePublishedAt, id: lastRow.id as number }
      : undefined;
    return { entries, nextCursor };
  }

  private querySearch(
    options: EntryQuery,
    searchTerms: ParsedSearchTerm[],
  ): EntryQueryResult {
    const esc = " ESCAPE '\\'";
    const plainSearch = getPlainSearchText(searchTerms);
    const titleTermConditions = searchTerms
      .map(() => `search_normalize(e.title) LIKE ?${esc}`)
      .join(' AND ');
    const titleTierSql = `CASE
      WHEN search_normalize(e.title) = ? COLLATE NOCASE THEN 4
      WHEN search_normalize(e.title) LIKE ?${esc} THEN 3
      WHEN (${titleTermConditions}) THEN 2
      ELSE 1
    END`;
    const titleTierParams: unknown[] = [
      plainSearch,
      `${escapeLike(plainSearch)}%`,
      ...searchTerms.map((term) => `%${escapeLike(term.value)}%`),
    ];

    const conditions: string[] = ['e.isDeleted = 0'];
    const whereParams: unknown[] = [];
    const useLikeFallback = requiresShortSearchFallback(searchTerms);
    let searchSource = '';
    let searchRankSql = '0';

    if (useLikeFallback) {
      for (const term of searchTerms) {
        conditions.push(`(
          search_normalize(e.title) LIKE ?${esc}
          OR search_normalize(ec.markdown) LIKE ?${esc}
        )`);
        const likeParam = `%${escapeLike(term.value)}%`;
        whereParams.push(likeParam, likeParam);
      }
    } else {
      searchSource = 'JOIN entry_search_fts ON entry_search_fts.rowid = e.id';
      conditions.push('entry_search_fts MATCH ?');
      whereParams.push(toFts5Query(searchTerms));
      searchRankSql = 'bm25(entry_search_fts, 8.0, 1.0)';
    }

    appendScopeConditions(options, conditions, whereParams);

    const cursorConditions: string[] = [];
    const cursorParams: unknown[] = [];
    if (options.cursor) {
      const { matchTier, rank, publishedAt, id } = options.cursor;
      if (matchTier === undefined || rank === undefined) {
        throw new RangeError('Ranked searches require a ranked cursor.');
      }
      cursorConditions.push(`(
        matchTier < ?
        OR (matchTier = ? AND searchRank > ?)
        OR (
          matchTier = ? AND searchRank = ?
          AND effectivePublishedAt < ?
        )
        OR (
          matchTier = ? AND searchRank = ?
          AND effectivePublishedAt = ? AND id < ?
        )
      )`);
      cursorParams.push(
        matchTier,
        matchTier, rank,
        matchTier, rank, publishedAt,
        matchTier, rank, publishedAt, id,
      );
    }

    const query = `
      WITH ranked_entries AS (
        SELECT
          e.*,
          f.title AS feedTitle,
          ec.pipelineStatus,
          ec.markdown AS searchMarkdown,
          COALESCE(e.publishedAt, e.createdAt) AS effectivePublishedAt,
          ${titleTierSql} AS matchTier,
          ${searchRankSql} AS searchRank
        FROM entry e
        ${searchSource}
        LEFT JOIN feed f ON f.id = e.feedId
        LEFT JOIN entry_content ec ON ec.entryId = e.id
        WHERE ${conditions.join(' AND ')}
      )
      SELECT *
      FROM ranked_entries
      ${cursorConditions.length > 0 ? `WHERE ${cursorConditions.join(' AND ')}` : ''}
      ORDER BY
        matchTier DESC,
        searchRank ASC,
        effectivePublishedAt DESC,
        id DESC
      LIMIT ?
    `;
    const rows = this.db.prepare(query).all(
      ...titleTierParams,
      ...whereParams,
      ...cursorParams,
      options.limit + 1,
    ) as Array<Record<string, unknown> & {
      effectivePublishedAt: string;
      matchTier: number;
      searchRank: number;
      searchMarkdown: string | null;
    }>;

    const hasMore = rows.length > options.limit;
    if (hasMore) rows.pop();
    const entries = rows.map((row) => {
      const entry = toEntryListItem(row);
      const searchSnippet = buildSearchSnippet(row.searchMarkdown, searchTerms);
      return searchSnippet ? { ...entry, searchSnippet } : entry;
    });
    const lastRow = hasMore ? rows.at(-1) : undefined;
    const nextCursor = lastRow
      ? {
          publishedAt: lastRow.effectivePublishedAt,
          id: lastRow.id as number,
          matchTier: lastRow.matchTier,
          rank: lastRow.searchRank,
        }
      : undefined;
    return { entries, nextCursor };
  }

  findByFeed(
    feedId: number,
    options: Omit<EntryQuery, 'feedId'> = { limit: 50 },
  ): EntryQueryResult {
    return this.query({ ...options, feedId });
  }

  markRead(ids: number[], isRead: boolean): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db
      .prepare(`
        UPDATE entry
        SET isRead = ?,
            readingProgress = ?,
            updatedAt = ?
        WHERE id IN (${placeholders})
      `)
      .run(isRead ? 1 : 0, isRead ? 1 : 0, new Date().toISOString(), ...ids);
  }

  updateReadingProgress(entryId: number, readingProgress: number): EntryReadingProgress {
    if (
      !Number.isInteger(entryId)
      || entryId <= 0
      || !Number.isFinite(readingProgress)
      || readingProgress < 0
      || readingProgress > 1
    ) {
      throw new RangeError('Reading progress must be between 0 and 1.');
    }
    const current = this.db.prepare(`
      SELECT isRead, readingProgress
      FROM entry
      WHERE id = ? AND isDeleted = 0
    `).get(entryId) as { isRead: number; readingProgress: number | null } | undefined;
    if (!current) throw new Error('Entry not found.');

    const persistedReadingProgress = Math.max(
      current.readingProgress ?? 0,
      readingProgress,
    );
    const isRead = current.isRead === 1 || persistedReadingProgress >= 1;
    this.db.prepare(`
      UPDATE entry
      SET readingProgress = ?,
          isRead = ?,
          updatedAt = ?
      WHERE id = ?
    `).run(
      persistedReadingProgress,
      isRead ? 1 : 0,
      new Date().toISOString(),
      entryId,
    );

    return {
      entryId,
      readingProgress: persistedReadingProgress,
      isRead,
      becameRead: current.isRead !== 1 && isRead,
    };
  }

  getReadStats(): EntryStats {
    const allRow = this.db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN isRead = 0 THEN 1 ELSE 0 END) AS unread
      FROM entry
      WHERE isDeleted = 0
    `).get() as { total: number; unread: number | null };
    const feedRows = this.db.prepare(`
      SELECT feedId,
             COUNT(*) AS total,
             SUM(CASE WHEN isRead = 0 THEN 1 ELSE 0 END) AS unread
      FROM entry
      WHERE isDeleted = 0
      GROUP BY feedId
      ORDER BY feedId
    `).all() as Array<{ feedId: number; total: number; unread: number | null }>;
    const tagCountRow = this.db.prepare(`
      SELECT COUNT(DISTINCT t.id) AS cnt
      FROM tag t
      INNER JOIN entry_tag et ON et.tagId = t.id
      INNER JOIN entry e ON e.id = et.entryId AND e.isDeleted = 0
    `).get() as { cnt: number };

    return {
      all: toReadStats(allRow),
      feeds: feedRows.map((row): FeedEntryReadStats => ({
        feedId: row.feedId,
        ...toReadStats(row),
      })),
      tagCount: tagCountRow.cnt,
    };
  }

  markStarred(id: number, isStarred: boolean): void {
    this.db
      .prepare('UPDATE entry SET isStarred = ?, updatedAt = ? WHERE id = ?')
      .run(isStarred ? 1 : 0, new Date().toISOString(), id);
  }

  updateContentHash(entryId: number, contentHash: string): void {
    this.db
      .prepare('UPDATE entry SET contentHash = ?, updatedAt = ? WHERE id = ?')
      .run(contentHash, new Date().toISOString(), entryId);
  }

  softDelete(id: number): void {
    this.db
      .prepare('UPDATE entry SET isDeleted = 1, updatedAt = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  countUnread(feedId?: number): number {
    let sql = 'SELECT COUNT(*) as cnt FROM entry WHERE isRead = 0 AND isDeleted = 0';
    const params: unknown[] = [];

    if (feedId !== undefined) {
      sql += ' AND feedId = ?';
      params.push(feedId);
    }

    const row = this.db.prepare(sql).get(...params) as { cnt: number };
    return row.cnt;
  }

  /**
   * Batch query tags for a set of entry IDs. Returns a Map<entryId, Tag[]>.
   */
  private batchTagsByEntry(entryIds: number[]): Map<number, Tag[]> {
    if (entryIds.length === 0) return new Map();
    const placeholders = entryIds.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT et.entryId, t.id, t.name, t.color
      FROM entry_tag et
      JOIN tag t ON t.id = et.tagId
      WHERE et.entryId IN (${placeholders})
      ORDER BY t.name COLLATE NOCASE ASC
    `).all(...entryIds) as Array<{ entryId: number; id: number; name: string; color: string }>;

    const map = new Map<number, Tag[]>();
    for (const row of rows) {
      let tags = map.get(row.entryId);
      if (!tags) {
        tags = [];
        map.set(row.entryId, tags);
      }
      tags.push({ id: row.id, name: row.name, color: row.color });
    }
    return map;
  }
}

const ALLOWED_FILTER_FIELDS: readonly FilterField[] = [
  'tag', 'feed', 'title', 'content', 'author', 'starred', 'read',
];

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
  if (options.tagFuzzyNames !== undefined) {
    if (!Array.isArray(options.tagFuzzyNames) || options.tagFuzzyNames.length > 50) {
      throw new RangeError('Entry query tagFuzzyNames must be an array of up to 50 strings.');
    }
    for (const name of options.tagFuzzyNames) {
      if (typeof name !== 'string' || name.length > 100) {
        throw new RangeError('Entry query tagFuzzyNames entries must be strings up to 100 characters.');
      }
    }
  }
  if (options.filters !== undefined) {
    if (!Array.isArray(options.filters) || options.filters.length > 50) {
      throw new RangeError('Entry query filters must be an array of up to 50 entries.');
    }
    for (const filter of options.filters) {
      if (!ALLOWED_FILTER_FIELDS.includes(filter.field)) {
        throw new RangeError(`Invalid filter field: "${filter.field}".`);
      }
      if (typeof filter.value !== 'string' || filter.value.length > 200) {
        throw new RangeError('Filter value must be a string up to 200 characters.');
      }
      if (filter.operator !== '+' && filter.operator !== '-' && filter.operator !== '') {
        throw new RangeError(`Invalid filter operator: "${filter.operator}".`);
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

function appendScopeConditions(
  options: EntryQuery,
  conditions: string[],
  params: unknown[],
): void {
  if (options.feedId !== undefined) {
    conditions.push('e.feedId = ?');
    params.push(options.feedId);
  }
  if (options.isRead !== undefined) {
    conditions.push('e.isRead = ?');
    params.push(options.isRead ? 1 : 0);
  }
  if (options.isStarred !== undefined) {
    conditions.push('e.isStarred = ?');
    params.push(options.isStarred ? 1 : 0);
  }

  // If structured `filters` is present, use it instead of old tagNames/tagFuzzyNames.
  // When both exist (transition period), skip the old path to avoid double-filtering.
  const hasStructuredFilters = !!(options.filters && options.filters.length > 0);
  const hasTagFilters = hasStructuredFilters
    && options.filters!.some((f) => f.field === 'tag');

  if (!hasStructuredFilters || !hasTagFilters) {
    // Tag filter: exact match on tag name(s)
    if (options.tagNames && options.tagNames.length > 0) {
      const tagNames = options.tagNames.filter((n) => n.trim().length > 0);
      if (tagNames.length > 0) {
        const placeholders = tagNames.map(() => '?').join(', ');
        const matchAll = options.matchAll !== false; // default AND
        if (matchAll) {
          conditions.push(
            `e.id IN (
              SELECT et.entryId FROM entry_tag et
              JOIN tag t ON t.id = et.tagId
              WHERE t.name IN (${placeholders})
              GROUP BY et.entryId
              HAVING COUNT(DISTINCT t.id) = ?
            )`
          );
          params.push(...tagNames, tagNames.length);
        } else {
          conditions.push(
            `e.id IN (
              SELECT et.entryId FROM entry_tag et
              JOIN tag t ON t.id = et.tagId
              WHERE t.name IN (${placeholders})
            )`
          );
          params.push(...tagNames);
        }
      }
    }

    // Tag filter: fuzzy match via LIKE on tag name(s)
    if (options.tagFuzzyNames && options.tagFuzzyNames.length > 0) {
      const fuzzyNames = options.tagFuzzyNames.filter((n) => n.trim().length > 0);
      if (fuzzyNames.length > 0) {
        const matchAll = options.matchAll !== false; // default AND
        const esc = " ESCAPE '\\'";
        const subConditions: string[] = fuzzyNames.map(
          (name) => `t.name LIKE ?${esc}`
        );
        if (matchAll) {
          // Each fuzzy name must match at least one tag (AND across terms)
          for (const name of fuzzyNames) {
            conditions.push(
              `e.id IN (
                SELECT et.entryId FROM entry_tag et
                JOIN tag t ON t.id = et.tagId
                WHERE t.name LIKE ?
              )`
            );
            params.push(`%${escapeLike(name)}%`);
          }
        } else {
          // Any fuzzy name can match (OR across terms)
          const likeParams = fuzzyNames.map((name) => `%${escapeLike(name)}%`);
          conditions.push(
            `e.id IN (
              SELECT et.entryId FROM entry_tag et
              JOIN tag t ON t.id = et.tagId
              WHERE ${subConditions.join(' OR ')}
            )`
          );
          params.push(...likeParams);
        }
      }
    }
  }

  // ── Structured filters ────────────────────────────────
  if (options.filters && options.filters.length > 0) {
    const esc = " ESCAPE '\\'";

    // Collect OR-group filters (same field, operator==='') for batch SQL
    const orGroups = new Map<FilterField, string[]>();

    for (const filter of options.filters) {
      if (filter.operator === '') {
        const group = orGroups.get(filter.field) || [];
        group.push(filter.value);
        orGroups.set(filter.field, group);
      } else {
        // + (AND) and - (NOT) applied individually
        appendSingleFilter(filter, conditions, params, esc);
      }
    }

    // Apply OR groups: same-field, operator==='' filters merged into one OR
    for (const [field, values] of orGroups) {
      appendOrGroupFilter(field, values, conditions, params, esc);
    }
  }
}

/** Apply a single + (AND) or - (NOT) filter. */
function appendSingleFilter(
  filter: SearchFilter,
  conditions: string[],
  params: unknown[],
  esc: string,
): void {
  const { field, operator, value } = filter;

  switch (field) {
    case 'tag': {
      if (operator === '-') {
        conditions.push(`NOT EXISTS (
          SELECT 1 FROM entry_tag et
          JOIN tag t ON t.id = et.tagId
          WHERE et.entryId = e.id AND t.name LIKE ?${esc}
        )`);
        params.push(`%${escapeLike(value)}%`);
      } else {
        // +tag: AND inclusion — fuzzy match via LIKE
        conditions.push(`e.id IN (
          SELECT et.entryId FROM entry_tag et
          JOIN tag t ON t.id = et.tagId
          WHERE t.name LIKE ?${esc}
        )`);
        params.push(`%${escapeLike(value)}%`);
      }
      break;
    }
    case 'feed': {
      if (operator === '-') {
        conditions.push(`search_normalize(f.title) NOT LIKE ?${esc}`);
      } else {
        conditions.push(`search_normalize(f.title) LIKE ?${esc}`);
      }
      params.push(`%${escapeLike(value)}%`);
      break;
    }
    case 'title': {
      if (operator === '-') {
        conditions.push(`search_normalize(e.title) NOT LIKE ?${esc}`);
      } else {
        conditions.push(`search_normalize(e.title) LIKE ?${esc}`);
      }
      params.push(`%${escapeLike(value)}%`);
      break;
    }
    case 'content': {
      if (operator === '-') {
        conditions.push(`(ec.markdown IS NULL OR search_normalize(ec.markdown) NOT LIKE ?${esc})`);
      } else {
        conditions.push(`search_normalize(ec.markdown) LIKE ?${esc}`);
      }
      params.push(`%${escapeLike(value)}%`);
      break;
    }
    case 'author': {
      if (operator === '-') {
        conditions.push(`(e.author IS NULL OR search_normalize(e.author) NOT LIKE ?${esc})`);
      } else {
        conditions.push(`search_normalize(e.author) LIKE ?${esc}`);
      }
      params.push(`%${escapeLike(value)}%`);
      break;
    }
    case 'starred': {
      const boolVal = (value === 'yes' || value === '1') ? 1 : 0;
      conditions.push('e.isStarred = ?');
      params.push(boolVal);
      break;
    }
    case 'read': {
      const boolVal = (value === 'yes' || value === '1') ? 1 : 0;
      conditions.push('e.isRead = ?');
      params.push(boolVal);
      break;
    }
  }
}

/** Apply an OR group: same field, operator === '', all values combined with OR. */
function appendOrGroupFilter(
  field: FilterField,
  values: string[],
  conditions: string[],
  params: unknown[],
  esc: string,
): void {
  switch (field) {
    case 'tag': {
      // OR across tag values — exact name match (from parser, tag:value is fuzzy via LIKE)
      const subConditions = values.map(() => `t.name LIKE ?${esc}`);
      const likeParams = values.map((v) => `%${escapeLike(v)}%`);
      conditions.push(
        `e.id IN (
          SELECT et.entryId FROM entry_tag et
          JOIN tag t ON t.id = et.tagId
          WHERE ${subConditions.join(' OR ')}
        )`
      );
      params.push(...likeParams);
      break;
    }
    case 'feed': {
      const subConditions = values.map(() => `search_normalize(f.title) LIKE ?${esc}`);
      conditions.push(`(${subConditions.join(' OR ')})`);
      params.push(...values.map((v) => `%${escapeLike(v)}%`));
      break;
    }
    case 'title': {
      const subConditions = values.map(() => `search_normalize(e.title) LIKE ?${esc}`);
      conditions.push(`(${subConditions.join(' OR ')})`);
      params.push(...values.map((v) => `%${escapeLike(v)}%`));
      break;
    }
    case 'content': {
      const subConditions = values.map(() => `search_normalize(ec.markdown) LIKE ?${esc}`);
      conditions.push(`(${subConditions.join(' OR ')})`);
      params.push(...values.map((v) => `%${escapeLike(v)}%`));
      break;
    }
    case 'author': {
      const subConditions = values.map(() => `search_normalize(e.author) LIKE ?${esc}`);
      conditions.push(`(${subConditions.join(' OR ')})`);
      params.push(...values.map((v) => `%${escapeLike(v)}%`));
      break;
    }
    case 'starred':
    case 'read': {
      // OR for scalar boolean fields doesn't make much sense, but handle it:
      // If any value is 'yes'/'1', it's truthy; otherwise all 'no'/'0' = falsy.
      const hasYes = values.some((v) => v === 'yes' || v === '1');
      const hasNo = values.some((v) => v === 'no' || v === '0');
      if (hasYes && hasNo) {
        // Contradiction: no rows match
        conditions.push('1 = 0');
      } else if (hasYes) {
        const col = field === 'starred' ? 'e.isStarred' : 'e.isRead';
        conditions.push(`${col} = 1`);
      } else {
        const col = field === 'starred' ? 'e.isStarred' : 'e.isRead';
        conditions.push(`${col} = 0`);
      }
      break;
    }
  }
}

function buildSearchSnippet(
  markdown: string | null,
  searchTerms: ParsedSearchTerm[],
): string | undefined {
  if (!markdown) return undefined;
  const plainText = normalizeSearchQuery(markdown);
  if (!plainText) return undefined;

  const foldedText = plainText.toLocaleLowerCase();
  const firstMatch = searchTerms.reduce<number | undefined>((earliest, term) => {
    const position = foldedText.indexOf(term.value.toLocaleLowerCase());
    if (position < 0) return earliest;
    return earliest === undefined ? position : Math.min(earliest, position);
  }, undefined);
  if (firstMatch === undefined) return undefined;

  const excerptLength = 190;
  const contextBefore = 70;
  let start = Math.max(0, firstMatch - contextBefore);
  let end = Math.min(plainText.length, start + excerptLength);

  if (start > 0) {
    const nextSpace = plainText.indexOf(' ', start);
    if (nextSpace > start && nextSpace < firstMatch) start = nextSpace + 1;
  }
  if (end < plainText.length) {
    const previousSpace = plainText.lastIndexOf(' ', end);
    if (previousSpace > firstMatch) end = previousSpace;
  }

  return `${start > 0 ? '…' : ''}${plainText.slice(start, end)}${
    end < plainText.length ? '…' : ''
  }`;
}

/**
 * Escape LIKE special characters so user input is treated literally.
 * SQLite default escape character: backslash.
 * Order matters: escape backslash first, then % and _.
 */
function escapeLike(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

function normalizeEntry(row: Record<string, unknown>): Entry {
  return {
    id: row.id as number,
    feedId: row.feedId as number,
    guid: (row.guid as string) ?? undefined,
    url: (row.url as string) ?? undefined,
    title: (row.title as string) ?? undefined,
    author: (row.author as string) ?? undefined,
    publishedAt: (row.publishedAt as string) ?? undefined,
    summary: (row.summary as string) ?? undefined,
    isRead: row.isRead === 1,
    readingProgress: (row.readingProgress as number) ?? 0,
    isStarred: row.isStarred === 1,
    isDeleted: row.isDeleted === 1,
    contentHash: (row.contentHash as string) ?? undefined,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

function toEntryListItem(row: Record<string, unknown>): EntryListItem {
  return {
    id: row.id as number,
    feedId: row.feedId as number,
    feedTitle: (row.feedTitle as string) ?? undefined,
    url: (row.url as string) ?? undefined,
    title: (row.title as string) ?? undefined,
    author: (row.author as string) ?? undefined,
    publishedAt: (row.publishedAt as string) ?? undefined,
    createdAt: row.createdAt as string,
    isRead: row.isRead === 1,
    readingProgress: (row.readingProgress as number) ?? 0,
    isStarred: row.isStarred === 1,
    summary: (row.summary as string) ?? undefined,
    pipelineStatus: (row.pipelineStatus as PipelineStatus) ?? 'pending',
  };
}

function toReadStats(row: { total: number; unread: number | null }): EntryReadStats {
  const total = row.total;
  const unread = row.unread ?? 0;
  return {
    total,
    unread,
    readPercentage: total === 0
      ? 0
      : Math.round(((total - unread) / total) * 100),
  };
}
