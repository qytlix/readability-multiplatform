import type Database from 'better-sqlite3';
import type { CleanedContent, PipelineStatus } from '../../shared/contracts/content.types';

interface UpsertContentParams {
  entryId: number;
  html?: string;
  sourceUrl?: string;
  cleanedHtml?: string;
  markdown?: string;
  readabilityTitle?: string;
  readabilityByline?: string;
  readabilityVersion?: number;
  markdownVersion?: number;
  documentBaseURL?: string;
  pipelineStatus: PipelineStatus;
  pipelineError?: string;
  segmenterVersion?: string;
  sourceContentHash?: string;
}

interface ContentRow {
  id: number;
  entryId: number;
  html: string | null;
  sourceUrl: string | null;
  cleanedHtml: string | null;
  markdown: string | null;
  readabilityTitle: string | null;
  readabilityByline: string | null;
  readabilityVersion: number;
  markdownVersion: number;
  documentBaseURL: string | null;
  pipelineStatus: string;
  pipelineError: string | null;
  segmenterVersion: string | null;
  sourceContentHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export class ContentStore {
  constructor(private db: Database.Database) {}

  findByEntry(entryId: number): CleanedContent | undefined {
    const row = this.db
      .prepare('SELECT * FROM entry_content WHERE entryId = ?')
      .get(entryId) as ContentRow | undefined;

    if (!row) return undefined;

    return {
      entryId: row.entryId,
      sourceUrl: row.sourceUrl ?? '',
      html: row.html ?? undefined,
      cleanedHtml: row.cleanedHtml ?? '',
      markdown: row.markdown ?? '',
      readabilityTitle: row.readabilityTitle ?? undefined,
      readabilityByline: row.readabilityByline ?? undefined,
      pipelineStatus: row.pipelineStatus as PipelineStatus,
      pipelineError: row.pipelineError ?? undefined,
      segmenterVersion: row.segmenterVersion ?? undefined,
      sourceContentHash: row.sourceContentHash ?? undefined,
    };
  }

  upsert(params: UpsertContentParams): void {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare('SELECT id FROM entry_content WHERE entryId = ?')
      .get(params.entryId) as { id: number } | undefined;

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE entry_content SET
          html = COALESCE(?, html),
          sourceUrl = COALESCE(?, sourceUrl),
          cleanedHtml = COALESCE(?, cleanedHtml),
          markdown = COALESCE(?, markdown),
          readabilityTitle = COALESCE(?, readabilityTitle),
          readabilityByline = COALESCE(?, readabilityByline),
          readabilityVersion = COALESCE(?, readabilityVersion),
          markdownVersion = COALESCE(?, markdownVersion),
          documentBaseURL = COALESCE(?, documentBaseURL),
          pipelineStatus = ?,
          pipelineError = ?,
          segmenterVersion = COALESCE(?, segmenterVersion),
          sourceContentHash = COALESCE(?, sourceContentHash),
          updatedAt = ?
        WHERE entryId = ?
      `);

      stmt.run(
        params.html ?? null,
        params.sourceUrl ?? null,
        params.cleanedHtml ?? null,
        params.markdown ?? null,
        params.readabilityTitle ?? null,
        params.readabilityByline ?? null,
        params.readabilityVersion ?? null,
        params.markdownVersion ?? null,
        params.documentBaseURL ?? null,
        params.pipelineStatus,
        params.pipelineError ?? null,
        params.segmenterVersion ?? null,
        params.sourceContentHash ?? null,
        now,
        params.entryId,
      );
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO entry_content
          (entryId, html, sourceUrl, cleanedHtml, markdown,
           readabilityTitle, readabilityByline, readabilityVersion, markdownVersion,
           documentBaseURL, pipelineStatus, pipelineError,
           segmenterVersion, sourceContentHash, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        params.entryId,
        params.html ?? null,
        params.sourceUrl ?? null,
        params.cleanedHtml ?? null,
        params.markdown ?? null,
        params.readabilityTitle ?? null,
        params.readabilityByline ?? null,
        params.readabilityVersion ?? null,
        params.markdownVersion ?? null,
        params.documentBaseURL ?? null,
        params.pipelineStatus,
        params.pipelineError ?? null,
        params.segmenterVersion ?? null,
        params.sourceContentHash ?? null,
        now,
        now,
      );
    }
  }

  updatePipelineStatus(
    entryId: number,
    status: PipelineStatus,
    error?: string,
  ): void {
    this.db
      .prepare(
        'UPDATE entry_content SET pipelineStatus = ?, pipelineError = ?, updatedAt = ? WHERE entryId = ?',
      )
      .run(status, error ?? null, new Date().toISOString(), entryId);
  }

  deleteByEntry(entryId: number): void {
    this.db
      .prepare('DELETE FROM entry_content WHERE entryId = ?')
      .run(entryId);
  }
}
