import type Database from 'better-sqlite3';
import type {
  CleanedContent,
  ContentSegment,
  ContentSegmentType,
  PipelineStatus,
} from '../../shared/contracts/content.types';

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
  segments?: ContentSegment[];
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
  segmentsJson: string | null;
  createdAt: string;
  updatedAt: string;
  readerTitle: string | null;
  readerByline: string | null;
}

export class ContentStore {
  constructor(private db: Database.Database) {}

  findByEntry(entryId: number): CleanedContent | undefined {
    const row = this.db
      .prepare(`
        SELECT entry_content.*, entry.title AS readerTitle, entry.author AS readerByline
        FROM entry_content
        JOIN entry ON entry.id = entry_content.entryId
        WHERE entry_content.entryId = ?
      `)
      .get(entryId) as ContentRow | undefined;

    if (!row) return undefined;

    return {
      entryId: row.entryId,
      sourceUrl: row.sourceUrl ?? '',
      readerTitle: row.readerTitle ?? row.readabilityTitle ?? undefined,
      readerByline: row.readerByline ?? row.readabilityByline ?? undefined,
      html: row.html ?? undefined,
      cleanedHtml: row.cleanedHtml ?? '',
      markdown: row.markdown ?? '',
      readabilityTitle: row.readabilityTitle ?? undefined,
      readabilityByline: row.readabilityByline ?? undefined,
      pipelineStatus: row.pipelineStatus as PipelineStatus,
      pipelineError: row.pipelineError ?? undefined,
      segmenterVersion: row.segmenterVersion ?? undefined,
      sourceContentHash: row.sourceContentHash ?? undefined,
      segments: parseSegments(row.segmentsJson),
    };
  }

  upsert(params: UpsertContentParams): void {
    const now = new Date().toISOString();
    const invalidateSegments = params.cleanedHtml !== undefined && params.segments === undefined;
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
          segmenterVersion = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, segmenterVersion) END,
          sourceContentHash = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, sourceContentHash) END,
          segmentsJson = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, segmentsJson) END,
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
        invalidateSegments ? 1 : 0,
        params.segmenterVersion ?? null,
        invalidateSegments ? 1 : 0,
        params.sourceContentHash ?? null,
        invalidateSegments ? 1 : 0,
        params.segments ? JSON.stringify(params.segments) : null,
        now,
        params.entryId,
      );
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO entry_content
          (entryId, html, sourceUrl, cleanedHtml, markdown,
           readabilityTitle, readabilityByline, readabilityVersion, markdownVersion,
           documentBaseURL, pipelineStatus, pipelineError,
           segmenterVersion, sourceContentHash, segmentsJson, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        params.segments ? JSON.stringify(params.segments) : null,
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

function parseSegments(serialized: string | null): ContentSegment[] | undefined {
  if (!serialized) return undefined;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed) || !parsed.every(isContentSegment)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function isContentSegment(value: unknown): value is ContentSegment {
  if (!value || typeof value !== 'object') return false;
  const segment = value as Record<string, unknown>;
  return (
    typeof segment.id === 'string'
    && Number.isInteger(segment.orderIndex)
    && isContentSegmentType(segment.type)
    && typeof segment.sourceHtml === 'string'
    && typeof segment.sourceText === 'string'
  );
}

function isContentSegmentType(value: unknown): value is ContentSegmentType {
  return value === 'title'
    || value === 'byline'
    || value === 'heading'
    || value === 'paragraph'
    || value === 'list'
    || value === 'blockquote'
    || value === 'caption';
}
