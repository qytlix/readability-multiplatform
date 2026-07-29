import type Database from 'better-sqlite3';
import type {
  ContentSegment,
  ContentSegmentType,
} from '../../../shared/contracts/content.types';
import type { ShaleError } from '../../../shared/contracts/feed.ipc';
import type {
  TranslationResult,
  TranslationMode,
  TranslationResultVariant,
  TranslationRunStatus,
  TranslationSegment,
  TranslationSegmentStatus,
  TranslationSourceLanguage,
  TranslationTargetLanguage,
  TranslationTerminologyMatch,
} from '../../../shared/contracts/translation.types';
import {
  LEGACY_TRANSLATION_VARIANT,
  STANDARD_TRANSLATION_MODE,
  TRANSLATION_MODES,
} from '../../../shared/contracts/translation.types';
import { TRANSLATION_ERROR_CODES } from '../../../shared/errors/translation.errors';

interface TranslationResultRow {
  id: number;
  entryId: number;
  sourceLanguage: TranslationSourceLanguage;
  targetLanguage: TranslationTargetLanguage;
  sourceContentHash: string;
  segmenterVersion: string;
  promptVersion: string;
  terminologyPackVersion: string;
  expertId: string;
  expertContentHash: string;
  smartContextEnabled: number;
  translationVariant: string;
  contextPromptVersion: string;
  contextWarningCode: string | null;
  contextWarningMessage: string | null;
  contextWarningRetryable: number | null;
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

export type DeepTranslationCheckpointStage = 'draft' | 'review' | 'rewrite';

export interface DeepTranslationBatchCheckpoint {
  batchKey: string;
  stage: DeepTranslationCheckpointStage;
  draftJson?: string;
  reviewJson?: string;
}

export interface CreateTranslationRunParams {
  entryId: number;
  providerProfileId: number;
  sourceLanguage: TranslationSourceLanguage;
  targetLanguage: TranslationTargetLanguage;
  sourceContentHash: string;
  segmenterVersion: string;
  promptVersion: string;
  terminologyPackVersion: string;
  expertId?: string;
  expertContentHash?: string;
  smartContextEnabled?: boolean;
  translationVariant?: TranslationMode;
  contextPromptVersion?: string;
  segments: ContentSegment[];
}

export class TranslationStore {
  constructor(private readonly db: Database.Database) {}

  findCompatibleResult(
    entryId: number,
    sourceLanguage: TranslationSourceLanguage,
    targetLanguage: TranslationTargetLanguage,
    sourceContentHash: string,
    segmenterVersion: string,
    promptVersion: string,
    terminologyPackVersion: string,
    expertId = 'none',
    expertContentHash = 'none',
    smartContextEnabled = false,
    contextPromptVersion = 'none',
    translationVariant: TranslationMode = STANDARD_TRANSLATION_MODE,
  ): TranslationResult | undefined {
    const row = this.db.prepare(`
      SELECT * FROM translation_result
      WHERE entryId = ? AND sourceLanguage = ? AND targetLanguage = ?
        AND sourceContentHash = ? AND segmenterVersion = ?
        AND promptVersion = ?
        AND terminologyPackVersion = ?
        AND expertId = ?
        AND expertContentHash = ?
        AND smartContextEnabled = ?
        AND contextPromptVersion = ?
        AND translationVariant = ?
      ORDER BY updatedAt DESC, id DESC
      LIMIT 1
    `).get(
      entryId,
      sourceLanguage,
      targetLanguage,
      sourceContentHash,
      segmenterVersion,
      promptVersion,
      terminologyPackVersion,
      expertId,
      expertContentHash,
      smartContextEnabled ? 1 : 0,
      contextPromptVersion,
      translationVariant,
    ) as TranslationResultRow | undefined;
    return row ? this.toResult(row) : undefined;
  }

  findActiveCompatibleResult(
    entryId: number,
    sourceLanguage: TranslationSourceLanguage,
    targetLanguage: TranslationTargetLanguage,
    sourceContentHash: string,
    segmenterVersion: string,
    promptVersion: string,
    terminologyPackVersion: string,
    expertId = 'none',
    expertContentHash = 'none',
    smartContextEnabled = false,
    contextPromptVersion = 'none',
    translationVariant: TranslationMode = STANDARD_TRANSLATION_MODE,
  ): TranslationResult | undefined {
    const row = this.db.prepare(`
      SELECT * FROM translation_result
      WHERE entryId = ? AND sourceLanguage = ? AND targetLanguage = ?
        AND sourceContentHash = ? AND segmenterVersion = ?
        AND promptVersion = ?
        AND terminologyPackVersion = ?
        AND expertId = ?
        AND expertContentHash = ?
        AND smartContextEnabled = ?
        AND contextPromptVersion = ?
        AND translationVariant = ?
        AND status = 'succeeded' AND isActive = 1
      ORDER BY completedAt DESC, id DESC
      LIMIT 1
    `).get(
      entryId,
      sourceLanguage,
      targetLanguage,
      sourceContentHash,
      segmenterVersion,
      promptVersion,
      terminologyPackVersion,
      expertId,
      expertContentHash,
      smartContextEnabled ? 1 : 0,
      contextPromptVersion,
      translationVariant,
    ) as TranslationResultRow | undefined;
    return row ? this.toResult(row) : undefined;
  }

  findLatestActiveResult(
    entryId: number,
    sourceLanguage: TranslationSourceLanguage,
    targetLanguage: TranslationTargetLanguage,
    sourceContentHash: string,
    segmenterVersion: string,
    translationVariant: TranslationMode = STANDARD_TRANSLATION_MODE,
  ): TranslationResult | undefined {
    const row = this.db.prepare(`
      SELECT * FROM translation_result
      WHERE entryId = ? AND sourceLanguage = ? AND targetLanguage = ?
        AND sourceContentHash = ? AND segmenterVersion = ?
        AND translationVariant = ?
        AND status = 'succeeded' AND isActive = 1
      ORDER BY completedAt DESC, id DESC
      LIMIT 1
    `).get(
      entryId,
      sourceLanguage,
      targetLanguage,
      sourceContentHash,
      segmenterVersion,
      translationVariant,
    ) as TranslationResultRow | undefined;
    return row ? this.toResult(row) : undefined;
  }

  findLatestActiveProductResult(
    entryId: number,
    sourceLanguage: TranslationSourceLanguage,
    targetLanguage: TranslationTargetLanguage,
    sourceContentHash: string,
    segmenterVersion: string,
  ): TranslationResult | undefined {
    const row = this.db.prepare(`
      SELECT * FROM translation_result
      WHERE entryId = ? AND sourceLanguage = ? AND targetLanguage = ?
        AND sourceContentHash = ? AND segmenterVersion = ?
        AND translationVariant IN ('standard', 'deep')
        AND status = 'succeeded' AND isActive = 1
      ORDER BY completedAt DESC, id DESC
      LIMIT 1
    `).get(
      entryId,
      sourceLanguage,
      targetLanguage,
      sourceContentHash,
      segmenterVersion,
    ) as TranslationResultRow | undefined;
    return row ? this.toResult(row) : undefined;
  }

  /**
   * Finds the product-mode run that still owns the current task lifecycle.
   * This is independent of the settings used for the next run, so a settings
   * change cannot hide or retarget an in-flight or paused task.
   */
  findLatestPendingProductResult(
    entryId: number,
    sourceLanguage: TranslationSourceLanguage,
    targetLanguage: TranslationTargetLanguage,
    sourceContentHash: string,
    segmenterVersion: string,
  ): TranslationResult | undefined {
    const row = this.db.prepare(`
      SELECT * FROM translation_result
      WHERE entryId = ? AND sourceLanguage = ? AND targetLanguage = ?
        AND sourceContentHash = ? AND segmenterVersion = ?
        AND translationVariant IN ('standard', 'deep')
        AND (
          status = 'running'
          OR (status = 'failed' AND errorCode = ?)
        )
      ORDER BY updatedAt DESC, id DESC
      LIMIT 1
    `).get(
      entryId,
      sourceLanguage,
      targetLanguage,
      sourceContentHash,
      segmenterVersion,
      TRANSLATION_ERROR_CODES.TRANSLATION_PAUSED,
    ) as TranslationResultRow | undefined;
    return row ? this.toResult(row) : undefined;
  }

  findLatestResult(
    entryId: number,
    sourceLanguage: TranslationSourceLanguage,
    targetLanguage: TranslationTargetLanguage,
  ): TranslationResult | undefined {
    const row = this.db.prepare(`
      SELECT * FROM translation_result
      WHERE entryId = ? AND sourceLanguage = ? AND targetLanguage = ?
      ORDER BY updatedAt DESC, id DESC LIMIT 1
    `).get(entryId, sourceLanguage, targetLanguage) as TranslationResultRow | undefined;
    return row ? this.toResult(row) : undefined;
  }

  createRun(params: CreateTranslationRunParams): TranslationResult {
    const now = new Date().toISOString();
    const persist = this.db.transaction(() => {
      const inserted = this.db.prepare(`
        INSERT INTO translation_result
          (entryId, providerProfileId, sourceLanguage, targetLanguage, sourceContentHash,
           segmenterVersion, promptVersion, terminologyPackVersion,
           expertId, expertContentHash, smartContextEnabled, translationVariant,
           contextPromptVersion,
           status, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)
      `).run(
        params.entryId,
        params.providerProfileId,
        params.sourceLanguage,
        params.targetLanguage,
        params.sourceContentHash,
        params.segmenterVersion,
        params.promptVersion,
        params.terminologyPackVersion,
        params.expertId ?? 'none',
        params.expertContentHash ?? 'none',
        params.smartContextEnabled ? 1 : 0,
        params.translationVariant ?? STANDARD_TRANSLATION_MODE,
        params.contextPromptVersion ?? 'none',
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

  markSegmentFailed(
    runId: number,
    sourceSegmentId: string,
    error: ShaleError,
  ): TranslationSegment {
    this.db.prepare(`
      UPDATE translation_segment
      SET status = 'failed', errorCode = ?, errorMessage = ?, updatedAt = ?
      WHERE translationResultId = ? AND sourceSegmentId = ? AND status = 'pending'
    `).run(
      error.code,
      error.message,
      new Date().toISOString(),
      runId,
      sourceSegmentId,
    );
    const segment = this.findSegment(runId, sourceSegmentId);
    if (!segment) throw new Error('Translation segment disappeared after failure.');
    return segment;
  }

  markRunSucceeded(runId: number): TranslationResult {
    const now = new Date().toISOString();
    const activate = this.db.transaction(() => {
      const run = this.db.prepare(`
        SELECT entryId, sourceLanguage, targetLanguage, sourceContentHash,
               segmenterVersion, promptVersion, terminologyPackVersion,
               expertId, expertContentHash, smartContextEnabled, translationVariant,
               contextPromptVersion
        FROM translation_result
        WHERE id = ? AND status = 'running'
      `).get(runId) as Pick<TranslationResultRow,
        'entryId' | 'sourceLanguage' | 'targetLanguage' | 'sourceContentHash'
        | 'segmenterVersion' | 'promptVersion' | 'terminologyPackVersion'
        | 'expertId' | 'expertContentHash' | 'smartContextEnabled' | 'translationVariant'
        | 'contextPromptVersion'
      > | undefined;
      if (!run) throw new Error('Translation run is not available for completion.');

      const incomplete = this.db.prepare(`
        SELECT 1 FROM translation_segment
        WHERE translationResultId = ? AND status != 'succeeded'
        LIMIT 1
      `).get(runId);
      if (incomplete) {
        throw new Error('Translation run cannot be activated before every segment succeeds.');
      }

      this.db.prepare(`
        UPDATE translation_result
        SET isActive = 0
        WHERE id != ?
          AND entryId = ? AND sourceLanguage = ? AND targetLanguage = ?
          AND sourceContentHash = ? AND segmenterVersion = ?
          AND promptVersion = ? AND terminologyPackVersion = ?
          AND expertId = ? AND expertContentHash = ?
          AND smartContextEnabled = ? AND translationVariant = ?
          AND contextPromptVersion = ?
          AND isActive = 1
      `).run(
        runId,
        run.entryId,
        run.sourceLanguage,
        run.targetLanguage,
        run.sourceContentHash,
        run.segmenterVersion,
        run.promptVersion,
        run.terminologyPackVersion,
        run.expertId,
        run.expertContentHash,
        run.smartContextEnabled,
        run.translationVariant,
        run.contextPromptVersion,
      );
      this.db.prepare(`
        UPDATE translation_result
        SET status = 'succeeded', isActive = 1,
            errorCode = NULL, errorMessage = NULL,
            errorRetryable = NULL, completedAt = ?, updatedAt = ?
        WHERE id = ? AND status = 'running'
      `).run(now, now, runId);
      this.db.prepare(`
        DELETE FROM translation_deep_batch_checkpoint WHERE translationResultId = ?
      `).run(runId);
    });
    activate();
    const result = this.findById(runId);
    if (!result) throw new Error('Translation result disappeared after completion.');
    return result;
  }

  setContextWarning(runId: number, warning?: ShaleError): void {
    this.db.prepare(`
      UPDATE translation_result
      SET contextWarningCode = ?,
          contextWarningMessage = ?,
          contextWarningRetryable = ?,
          updatedAt = ?
      WHERE id = ?
    `).run(
      warning?.code ?? null,
      warning?.message ?? null,
      warning ? (warning.retryable ? 1 : 0) : null,
      new Date().toISOString(),
      runId,
    );
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

  markRunPaused(runId: number, error: ShaleError): TranslationResult {
    this.markRunFailed(runId, error);
    const result = this.findById(runId);
    if (!result) throw new Error('Translation result disappeared while pausing.');
    return result;
  }

  reconcileInterruptedRuns(): number {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
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
    return result.changes;
  }

  findDeepBatchCheckpoint(
    runId: number,
    batchKey: string,
  ): DeepTranslationBatchCheckpoint | undefined {
    const row = this.db.prepare(`
      SELECT batchKey, stage, draftJson, reviewJson
      FROM translation_deep_batch_checkpoint
      WHERE translationResultId = ? AND batchKey = ?
    `).get(runId, batchKey) as {
      batchKey: string;
      stage: DeepTranslationCheckpointStage;
      draftJson: string | null;
      reviewJson: string | null;
    } | undefined;
    if (!row) return undefined;
    return {
      batchKey: row.batchKey,
      stage: row.stage,
      ...(row.draftJson ? { draftJson: row.draftJson } : {}),
      ...(row.reviewJson ? { reviewJson: row.reviewJson } : {}),
    };
  }

  saveDeepBatchCheckpoint(
    runId: number,
    checkpoint: DeepTranslationBatchCheckpoint,
  ): void {
    this.db.prepare(`
      INSERT INTO translation_deep_batch_checkpoint
        (translationResultId, batchKey, stage, draftJson, reviewJson, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(translationResultId, batchKey) DO UPDATE SET
        stage = excluded.stage,
        draftJson = excluded.draftJson,
        reviewJson = excluded.reviewJson,
        updatedAt = excluded.updatedAt
    `).run(
      runId,
      checkpoint.batchKey,
      checkpoint.stage,
      checkpoint.draftJson ?? null,
      checkpoint.reviewJson ?? null,
      new Date().toISOString(),
    );
  }

  clearDeepBatchCheckpoint(runId: number, batchKey: string): void {
    this.db.prepare(`
      DELETE FROM translation_deep_batch_checkpoint
      WHERE translationResultId = ? AND batchKey = ?
    `).run(runId, batchKey);
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
      sourceLanguage: row.sourceLanguage,
      targetLanguage: row.targetLanguage,
      sourceContentHash: row.sourceContentHash,
      segmenterVersion: row.segmenterVersion,
      terminologyPackVersion: row.terminologyPackVersion,
      promptVersion: row.promptVersion,
      expertId: row.expertId,
      expertContentHash: row.expertContentHash,
      smartContextEnabled: row.smartContextEnabled === 1,
      translationVariant: toTranslationResultVariant(row.translationVariant),
      contextPromptVersion: row.contextPromptVersion,
      contextWarning: toError(
        row.contextWarningCode,
        row.contextWarningMessage,
        row.contextWarningRetryable,
      ),
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

function toTranslationResultVariant(value: string): TranslationResultVariant {
  if (value === LEGACY_TRANSLATION_VARIANT) return value;
  if (TRANSLATION_MODES.includes(value as TranslationMode)) {
    return value as TranslationMode;
  }
  return LEGACY_TRANSLATION_VARIANT;
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
