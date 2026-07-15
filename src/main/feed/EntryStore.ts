import type Database from 'better-sqlite3';
import type { Entry, EntryListItem, EntryQuery } from '../../shared/contracts/feed.types';
import type { PipelineStatus } from '../../shared/contracts/content.types';

interface UpsertEntryParams {
  feedId: number;
  guid?: string;
  url?: string;
  title?: string;
  author?: string;
  publishedAt?: string;
  summary?: string;
  contentHash?: string;
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
        params.contentHash ?? null,
        now,
        existingId,
      );

      return { id: existingId, isNew: false };
    }

    // Create new entry
    const stmt = this.db.prepare(`
      INSERT INTO entry (feedId, guid, url, title, author, publishedAt, summary, contentHash, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      params.feedId,
      params.guid ?? null,
      params.url ?? null,
      params.title ?? null,
      params.author ?? null,
      params.publishedAt ?? null,
      params.summary ?? null,
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

  /**
   * Query entries with optional filters and keyset pagination.
   */
  query(options: EntryQuery): { entries: EntryListItem[]; nextCursor?: { publishedAt: string; id: number } } {
    const conditions: string[] = ['e.isDeleted = 0'];
    const params: unknown[] = [];

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

    if (options.search) {
      conditions.push('(e.title LIKE ? OR e.summary LIKE ?)');
      params.push(`%${options.search}%`, `%${options.search}%`);
    }

    // Keyset pagination
    if (options.cursor) {
      conditions.push('(e.publishedAt < ? OR (e.publishedAt = ? AND e.id < ?))');
      params.push(options.cursor.publishedAt, options.cursor.publishedAt, options.cursor.id);
    }

    const limit = options.limit ?? 50;
    const query = `
      SELECT e.*, f.title AS feedTitle, ec.pipelineStatus
      FROM entry e
      LEFT JOIN feed f ON f.id = e.feedId
      LEFT JOIN entry_content ec ON ec.entryId = e.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.publishedAt DESC, e.id DESC
      LIMIT ?
    `;
    params.push(limit + 1); // Fetch one extra to detect next page

    const rows = this.db.prepare(query).all(...params) as Array<
      Record<string, unknown>
    >;

    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();

    const entries = rows.map(toEntryListItem);

    let nextCursor: { publishedAt: string; id: number } | undefined;
    if (hasMore && entries.length > 0) {
      const last = entries[entries.length - 1];
      nextCursor = {
        publishedAt: last.publishedAt ?? last.createdAt,
        id: last.id,
      };
    }

    return { entries, nextCursor };
  }

  findByFeed(
    feedId: number,
    options: Omit<EntryQuery, 'feedId'> = { limit: 50 },
  ): { entries: EntryListItem[]; nextCursor?: { publishedAt: string; id: number } } {
    return this.query({ ...options, feedId });
  }

  markRead(ids: number[], isRead: boolean): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db
      .prepare(`UPDATE entry SET isRead = ?, updatedAt = ? WHERE id IN (${placeholders})`)
      .run(isRead ? 1 : 0, new Date().toISOString(), ...ids);
  }

  markStarred(id: number, isStarred: boolean): void {
    this.db
      .prepare('UPDATE entry SET isStarred = ?, updatedAt = ? WHERE id = ?')
      .run(isStarred ? 1 : 0, new Date().toISOString(), id);
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
    title: (row.title as string) ?? undefined,
    author: (row.author as string) ?? undefined,
    publishedAt: (row.publishedAt as string) ?? undefined,
    createdAt: row.createdAt as string,
    isRead: row.isRead === 1,
    isStarred: row.isStarred === 1,
    summary: (row.summary as string) ?? undefined,
    pipelineStatus: (row.pipelineStatus as PipelineStatus) ?? 'pending',
  };
}