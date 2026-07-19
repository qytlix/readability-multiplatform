import type Database from 'better-sqlite3';
import type { Feed, SyncStatus } from '../../../shared/contracts/feed.types';

interface CreateFeedParams {
  title?: string;
  feedURL: string;
  siteURL?: string;
  syncIntervalMin?: number;
}

interface UpdateFeedParams {
  title?: string;
  siteURL?: string;
  feedParserVersion?: number;
  syncIntervalMin?: number;
}

export class FeedStore {
  constructor(private db: Database.Database) {}

  create(params: CreateFeedParams): Feed {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO feed (title, feedURL, siteURL, syncIntervalMin, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      params.title ?? null,
      params.feedURL,
      params.siteURL ?? null,
      params.syncIntervalMin ?? 30,
      now,
    );

    return this.findById(result.lastInsertRowid as number)!;
  }

  findById(id: number): Feed | undefined {
    const stmt = this.db.prepare('SELECT * FROM feed WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? normalizeFeed(row) : undefined;
  }

  findByUrl(url: string): Feed | undefined {
    const stmt = this.db.prepare('SELECT * FROM feed WHERE feedURL = ?');
    const row = stmt.get(url) as Record<string, unknown> | undefined;
    return row ? normalizeFeed(row) : undefined;
  }

  findAll(): Feed[] {
    const stmt = this.db.prepare('SELECT * FROM feed ORDER BY title ASC');
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map(normalizeFeed);
  }

  update(id: number, params: UpdateFeedParams): Feed | undefined {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (params.title !== undefined) {
      fields.push('title = ?');
      values.push(params.title);
    }
    if (params.siteURL !== undefined) {
      fields.push('siteURL = ?');
      values.push(params.siteURL);
    }
    if (params.feedParserVersion !== undefined) {
      fields.push('feedParserVersion = ?');
      values.push(params.feedParserVersion);
    }
    if (params.syncIntervalMin !== undefined) {
      fields.push('syncIntervalMin = ?');
      values.push(params.syncIntervalMin);
    }

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    this.db
      .prepare(`UPDATE feed SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.findById(id);
  }

  updateSyncStatus(
    id: number,
    status: SyncStatus,
    error?: string,
  ): void {
    const now = new Date().toISOString();
    const fields: string[] = ['lastSyncStatus = ?', 'lastFetchedAt = ?'];
    const values: unknown[] = [status, now];

    if (error !== undefined) {
      fields.push('lastSyncError = ?');
      values.push(error);
    }

    values.push(id);
    this.db
      .prepare(`UPDATE feed SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
  }

  updateSyncHeaders(
    id: number,
    etag?: string,
    lastModified?: string,
  ): void {
    this.db
      .prepare('UPDATE feed SET lastETag = ?, lastModified = ? WHERE id = ?')
      .run(etag ?? null, lastModified ?? null, id);
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM feed WHERE id = ?').run(id);
  }

  /**
   * Delete all feeds except those whose URLs are in the keepUrls set.
   * Used for OPML replace mode.
   */
  deleteAllExcept(keepUrls: Set<string>): number {
    const allFeeds = this.findAll();
    const toDelete = allFeeds.filter(
      (f) => !keepUrls.has(f.feedURL.toLowerCase()),
    );

    const deleteStmt = this.db.prepare('DELETE FROM feed WHERE id = ?');
    const deleteMany = this.db.transaction((ids: number[]) => {
      for (const id of ids) {
        deleteStmt.run(id);
      }
    });

    deleteMany(toDelete.map((f) => f.id));
    return toDelete.length;
  }
}

function normalizeFeed(row: Record<string, unknown>): Feed {
  return {
    id: row.id as number,
    title: (row.title as string) ?? undefined,
    feedURL: row.feedURL as string,
    siteURL: (row.siteURL as string) ?? undefined,
    feedParserVersion: (row.feedParserVersion as number) ?? undefined,
    lastFetchedAt: (row.lastFetchedAt as string) ?? undefined,
    lastSyncStatus: row.lastSyncStatus as SyncStatus,
    lastSyncError: (row.lastSyncError as string) ?? undefined,
    lastETag: (row.lastETag as string) ?? undefined,
    lastModified: (row.lastModified as string) ?? undefined,
    syncIntervalMin: row.syncIntervalMin as number,
    createdAt: row.createdAt as string,
  };
}