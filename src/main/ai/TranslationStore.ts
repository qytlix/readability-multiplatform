import type Database from 'better-sqlite3';
import type {
  ContentSegment,
  ContentSegmentType,
} from '../../shared/contracts/content.types';
import type { ShaleError } from '../../shared/contracts/feed.ipc';
import type {
  TranslationResult,
  TranslationRunStatus,
  TranslationSegment,
  TranslationSegmentStatus,
  TranslationTargetLanguage,
  TranslationTerminologyMatch,
} from '../../shared/contracts/translation.types';
import { TRANSLATION_ERROR_CODES } from '../../shared/errors/translation.errors';

interface TranslationResultRow {
  id: number;
  entryId: number;
  targetLanguage: TranslationTargetLanguage;
  sourceContentHash: string;
  segmenterVersion: string;
  promptVersion: string;
  terminologyPackVersion: string;
  status: TranslationRunStatus;
  errorCode: string | null;
  errorMessage: string | null;
  errorRetryable: number | null;
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
}

interface TranslationSegmentRow {
  sourceSegmentId: string;
  orderIndex: number;
  sourceType: ContentSegmentType;
  sourceHtml: string;
  sourceText: string;
  translatedText: string | null;
  translatedHtml: string | null;
  terminologyMatchesJson: string | null;
  status: TranslationSegmentStatus;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface CreateTranslationRunParams {
  entryId: number;
  providerProfileId: number;
  targetLanguage: TranslationTargetLanguage;
  sourceContentHash: string;
  segmenterVersion: string;
  promptVersion: string;
  terminologyPackVersion: string;
  segments: ContentSegment[];
}

export class TranslationStore {
  constructor(private readonly db: Database.Database) {}

  findCompatibleResult(
    entryId: number,
    targetLanguage: TranslationTargetLanguage,
    sourceContentHash: string,
    segmenterVersion: string,
    promptVersion: string,
    terminologyPackVersion: string,
  ): TranslationResult | undefined {
    const row = this.db.prepare(`
      SELECT * FROM translation_result
      WHERE entryId = ? AND targetLanguage = ?
        AND sourceContentHash = ? AND segmenterVersion = ?
        AND promptVersion = ?
        AND terminologyPackVersion = ?
    `).get(
      entryId,
      targetLanguage,
      sourceContentHash,
      segmenterVersion,
      promptVersion,
      terminologyPackVersion,
    ) as TranslationResultRow | undefined;
    return row ? this.toResult(row) : undefined;
  }

  findLatestResult(
    entryId: number,
    targetLanguage: TranslationTargetLanguage,
  ): TranslationResult | undefined {
    const row = this.db.prepare(`
      SELECT * FROM translation_result
      WHERE entryId = ? AND targetLanguage = ?
      ORDER BY updatedAt DESC, id DESC LIMIT 1
    `).get(entryId, targetLanguage) as TranslationResultRow | undefined;
    return row ? this.toResult(row) : undefined;
  }

  createRun(params: CreateTranslationRunParams): TranslationResult {
    const now = new Date().toISOString();
    const persist = this.db.transaction(() => {
      this.db.prepare(`
        DELETE FROM translation_result
        WHERE entryId = ? AND targetLanguage = ?
          AND sourceContentHash = ? AND segmenterVersion = ?
      `).run(
        params.entryId,
        params.targetLanguage,
        params.sourceContentHash,
        params.segmenterVersion,
      );
      const inserted = this.db.prepare(`
        INSERT INTO translation_result
          (entryId, providerProfileId, targetLanguage, sourceContentHash,
           segmenterVersion, promptVersion, terminologyPackVersion,
           status, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)
      `).run(
        params.entryId,
        params.providerProfileId,
        params.targetLanguage,
        params.sourceContentHash,
        params.segmenterVersion,
        params.promptVersion,
        params.terminologyPackVersion,
        now,
        now,
      );
      const runId = Number(inserted.lastInsertRowid);
      const insertSegment = this.db.prepare(`
        INSERT INTO translation_segment
          (translationResultId, sourceSegmentId, orderIndex, sourceType,
           sourceHtml, sourceText, status, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `);
      for (const segment of params.segments) {
        insertSegment.run(
          runId,
          segment.id,
          segment.orderIndex,
          segment.type,
          segment.sourceHtml,
          segment.sourceText,
          now,
          now,
        );
      }
      return runId;
    });
    const runId = persist();
    const result = this.findById(runId);
    if (!result) throw new Error('Translation run was not persisted.');
    return result;
  }

  resumeRun(runId: number, providerProfileId?: number): TranslationResult {
    const now = new Date().toISOString();
    const resume = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE translation_result
        SET status = 'running', errorCode = NULL, errorMessage = NULL,
            errorRetryable = NULL, completedAt = NULL,
            providerProfileId = COALESCE(?, providerProfileId), updatedAt = ?
        WHERE id = ?
      `).run(providerProfileId ?? null, now, runId);
      this.db.prepare(`
        UPDATE translation_segment
        SET status = 'pending', errorCode = NULL, errorMessage = NULL, updatedAt = ?
        WHERE translationResultId = ? AND status = 'failed'
      `).run(now, runId);
    });
    resume();
    const result = this.findById(runId);
    if (!result) throw new Error('Translation run disappeared while resuming.');
    return result;
  }

  markSegmentSucceeded(
    runId: number,
    sourceSegmentId: string,
    translatedText: string,
    translatedHtml: string,
    terminologyMatches: TranslationTerminologyMatch[],
  ): TranslationSegment {
    this.db.prepare(`
      UPDATE translation_segment
      SET status = 'succeeded', translatedText = ?, translatedHtml = ?,
          terminologyMatchesJson = ?, errorCode = NULL,
          errorMessage = NULL, updatedAt = ?
      WHERE translationResultId = ? AND sourceSegmentId = ? AND status = 'pending'
    `).run(
      translatedText,
      translatedHtml,
      JSON.stringify(terminologyMatches),
      new Date().toISOString(),
      runId,
      sourceSegmentId,
    );
    const segment = this.findSegment(runId, sourceSegmentId);
    if (!segment) throw new Error('Translation segment disappeared after completion.');
    return segment;
  }

  markRunSucceeded(runId: number): TranslationResult {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE translation_result
      SET status = 'succeeded', errorCode = NULL, errorMessage = NULL,
          errorRetryable = NULL, completedAt = ?, updatedAt = ?
      WHERE id = ? AND status = 'running'
    `).run(now, now, runId);
    const result = this.findById(runId);
    if (!result) throw new Error('Translation result disappeared after completion.');
    return result;
  }

  markRunFailed(
    runId: number,
    error: ShaleError,
    sourceSegmentId?: string,
  ): void {
    const now = new Date().toISOString();
    const persist = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE translation_result
        SET status = 'failed', errorCode = ?, errorMessage = ?, errorRetryable = ?,
            completedAt = ?, updatedAt = ?
        WHERE id = ? AND status = 'running'
      `).run(error.code, error.message, error.retryable ? 1 : 0, now, now, runId);
      if (sourceSegmentId) {
        this.db.prepare(`
          UPDATE translation_segment
          SET status = 'failed', errorCode = ?, errorMessage = ?, updatedAt = ?
          WHERE translationResultId = ? AND sourceSegmentId = ? AND status = 'pending'
        `).run(error.code, error.message, now, runId, sourceSegmentId);
      }
    });
    persist();
  }

  reconcileInterruptedRuns(): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE translation_result
      SET status = 'failed', errorCode = ?, errorMessage = ?, errorRetryable = 1,
          completedAt = ?, updatedAt = ?
      WHERE status = 'running'
    `).run(
      TRANSLATION_ERROR_CODES.TRANSLATION_INTERRUPTED,
      'Translation generation was interrupted before completion.',
      now,
      now,
    );
  }

  private findById(runId: number): TranslationResult | undefined {
    const row = this.db.prepare('SELECT * FROM translation_result WHERE id = ?')
      .get(runId) as TranslationResultRow | undefined;
    return row ? this.toResult(row) : undefined;
  }

  private toResult(row: TranslationResultRow): TranslationResult {
    const segmentRows = this.db.prepare(`
      SELECT sourceSegmentId, orderIndex, sourceType, sourceHtml, sourceText,
             translatedText, translatedHtml, terminologyMatchesJson,
             status, errorCode, errorMessage
      FROM translation_segment WHERE translationResultId = ? ORDER BY orderIndex ASC
    `).all(row.id) as TranslationSegmentRow[];
    return {
      id: row.id,
      entryId: row.entryId,
      targetLanguage: row.targetLanguage,
      sourceContentHash: row.sourceContentHash,
      segmenterVersion: row.segmenterVersion,
      terminologyPackVersion: row.terminologyPackVersion,
      promptVersion: row.promptVersion,
      status: row.status,
      error: toError(row.errorCode, row.errorMessage, row.errorRetryable),
      createdAt: row.createdAt,
      completedAt: row.completedAt ?? undefined,
      updatedAt: row.updatedAt,
      segments: segmentRows.map(toSegment),
    };
  }

  private findSegment(
    runId: number,
    sourceSegmentId: string,
  ): TranslationSegment | undefined {
    const row = this.db.prepare(`
      SELECT sourceSegmentId, orderIndex, sourceType, sourceHtml, sourceText,
             translatedText, translatedHtml, terminologyMatchesJson,
             status, errorCode, errorMessage
      FROM translation_segment
      WHERE translationResultId = ? AND sourceSegmentId = ?
    `).get(runId, sourceSegmentId) as TranslationSegmentRow | undefined;
    return row ? toSegment(row) : undefined;
  }
}

function toSegment(row: TranslationSegmentRow): TranslationSegment {
  return {
    sourceSegmentId: row.sourceSegmentId,
    orderIndex: row.orderIndex,
    sourceType: row.sourceType,
    sourceHtml: row.sourceHtml,
    sourceText: row.sourceText,
    translatedText: row.translatedText ?? undefined,
    translatedHtml: row.translatedHtml ?? undefined,
    terminologyMatches: parseTerminologyMatches(row.terminologyMatchesJson),
    status: row.status,
    error: toError(row.errorCode, row.errorMessage),
  };
}

function parseTerminologyMatches(
  serialized: string | null,
): TranslationTerminologyMatch[] {
  if (!serialized) return [];
  try {
    const value: unknown = JSON.parse(serialized);
    return Array.isArray(value) ? value.filter(isTerminologyMatch) : [];
  } catch {
    return [];
  }
}

function isTerminologyMatch(value: unknown): value is TranslationTerminologyMatch {
  if (!value || typeof value !== 'object') return false;
  const match = value as Record<string, unknown>;
  return typeof match.conceptId === 'string'
    && typeof match.sourceId === 'string'
    && typeof match.sourceTerm === 'string'
    && typeof match.targetTerm === 'string';
}

function toError(
  code: string | null,
  message: string | null,
  retryable?: number | null,
): ShaleError | undefined {
  return code && message
    ? { code, message, retryable: retryable === 1 }
    : undefined;
}
