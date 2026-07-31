import type Database from 'better-sqlite3';

export interface ArticleSegmentAnalysis {
  segmentId: string;
  orderIndex: number;
  analysis: string;
}

export interface ArticleContextCacheIdentity {
  entryId: number;
  sourceContentHash: string;
  promptVersion: string;
  compressionVersion: string;
  analysisModelFamily: string;
}

export interface ArticleContextCacheRecord extends ArticleContextCacheIdentity {
  id: number;
  formattedContext: string;
  articleMap?: string;
  segmentAnalyses?: ArticleSegmentAnalysis[];
  estimatedTokens: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveArticleContextCacheParams extends ArticleContextCacheIdentity {
  formattedContext: string;
  articleMap?: string;
  segmentAnalyses?: ArticleSegmentAnalysis[];
  estimatedTokens: number;
}

interface ArticleContextCacheRow extends ArticleContextCacheIdentity {
  id: number;
  formattedContext: string;
  articleMap: string | null;
  segmentAnalysesJson: string | null;
  estimatedTokens: number;
  createdAt: string;
  updatedAt: string;
}

export class ArticleContextCacheStore {
  constructor(private readonly db: Database.Database) {}

  find(identity: ArticleContextCacheIdentity): ArticleContextCacheRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM ai_article_context_cache
      WHERE entryId = ? AND sourceContentHash = ? AND promptVersion = ?
        AND compressionVersion = ? AND analysisModelFamily = ?
    `).get(
      identity.entryId,
      identity.sourceContentHash,
      identity.promptVersion,
      identity.compressionVersion,
      identity.analysisModelFamily,
    ) as ArticleContextCacheRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  save(params: SaveArticleContextCacheParams): ArticleContextCacheRecord {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO ai_article_context_cache
        (entryId, sourceContentHash, promptVersion, compressionVersion,
         analysisModelFamily, formattedContext, articleMap,
         segmentAnalysesJson, estimatedTokens, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(
        entryId, sourceContentHash, promptVersion,
        compressionVersion, analysisModelFamily
      ) DO UPDATE SET
        formattedContext = excluded.formattedContext,
        articleMap = excluded.articleMap,
        segmentAnalysesJson = excluded.segmentAnalysesJson,
        estimatedTokens = excluded.estimatedTokens,
        updatedAt = excluded.updatedAt
    `).run(
      params.entryId,
      params.sourceContentHash,
      params.promptVersion,
      params.compressionVersion,
      params.analysisModelFamily,
      params.formattedContext,
      params.articleMap ?? null,
      params.segmentAnalyses ? JSON.stringify(params.segmentAnalyses) : null,
      params.estimatedTokens,
      now,
      now,
    );
    const saved = this.find(params);
    if (!saved) throw new Error('Article context cache was not persisted.');
    return saved;
  }
}

function toRecord(row: ArticleContextCacheRow): ArticleContextCacheRecord {
  const segmentAnalyses = parseSegmentAnalyses(row.segmentAnalysesJson);
  return {
    id: row.id,
    entryId: row.entryId,
    sourceContentHash: row.sourceContentHash,
    promptVersion: row.promptVersion,
    compressionVersion: row.compressionVersion,
    analysisModelFamily: row.analysisModelFamily,
    formattedContext: row.formattedContext,
    ...(row.articleMap === null ? {} : { articleMap: row.articleMap }),
    ...(segmentAnalyses ? { segmentAnalyses } : {}),
    estimatedTokens: row.estimatedTokens,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseSegmentAnalyses(
  serialized: string | null,
): ArticleSegmentAnalysis[] | undefined {
  if (!serialized) return undefined;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed) || !parsed.every(isSegmentAnalysis)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function isSegmentAnalysis(value: unknown): value is ArticleSegmentAnalysis {
  if (!value || typeof value !== 'object') return false;
  const analysis = value as Record<string, unknown>;
  return typeof analysis.segmentId === 'string'
    && Number.isInteger(analysis.orderIndex)
    && typeof analysis.analysis === 'string';
}
