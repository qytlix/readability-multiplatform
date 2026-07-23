import type Database from 'better-sqlite3';
import type { ShaleError } from '../../../shared/contracts/feed.ipc';
import type {
  SummaryDetailLevel,
  SummaryResult,
  SummaryRun,
  SummaryRunStatus,
  SummaryTargetLanguage,
} from '../../../shared/contracts/summary.types';
import { SUMMARY_ERROR_CODES } from '../../../shared/errors/summary.errors';

interface SummaryRunRow {
  id: number;
  entryId: number;
  targetLanguage: SummaryTargetLanguage;
  detailLevel: SummaryDetailLevel;
  status: SummaryRunStatus;
  errorCode: string | null;
  errorMessage: string | null;
  errorRetryable: number | null;
  createdAt: string;
  completedAt: string | null;
}

interface SummaryResultRow {
  id: number;
  runId: number;
  entryId: number;
  targetLanguage: SummaryTargetLanguage;
  detailLevel: SummaryDetailLevel;
  content: string;
  inputMarkdownHash: string;
  promptVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSummaryRunParams {
  entryId: number;
  providerProfileId: number;
  targetLanguage: SummaryTargetLanguage;
  detailLevel: SummaryDetailLevel;
  inputMarkdownHash: string;
}

export interface SaveSummaryResultParams {
  runId: number;
  entryId: number;
  targetLanguage: SummaryTargetLanguage;
  detailLevel: SummaryDetailLevel;
  inputMarkdownHash: string;
  promptVersion: string;
  content: string;
}

export class SummaryStore {
  constructor(private readonly db: Database.Database) {}

  createRun(params: CreateSummaryRunParams): SummaryRun {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(`
        INSERT INTO agent_task_run
          (entryId, taskType, providerProfileId, targetLanguage, detailLevel,
           inputMarkdownHash, status, createdAt)
        VALUES (?, 'summary', ?, ?, ?, ?, 'running', ?)
      `)
      .run(
        params.entryId,
        params.providerProfileId,
        params.targetLanguage,
        params.detailLevel,
        params.inputMarkdownHash,
        now,
      );

    return {
      id: Number(result.lastInsertRowid),
      entryId: params.entryId,
      targetLanguage: params.targetLanguage,
      detailLevel: params.detailLevel,
      status: 'running',
      createdAt: now,
    };
  }

  findRunningRun(
    entryId: number,
    targetLanguage: SummaryTargetLanguage,
    detailLevel: SummaryDetailLevel,
  ): SummaryRun | undefined {
    const row = this.db
      .prepare(`
        SELECT * FROM agent_task_run
        WHERE entryId = ? AND targetLanguage = ? AND detailLevel = ? AND status = 'running'
        ORDER BY id DESC LIMIT 1
      `)
      .get(entryId, targetLanguage, detailLevel) as SummaryRunRow | undefined;
    return row ? toSummaryRun(row) : undefined;
  }

  findLatestFailedRun(
    entryId: number,
    targetLanguage: SummaryTargetLanguage,
    detailLevel: SummaryDetailLevel,
  ): SummaryRun | undefined {
    const row = this.db
      .prepare(`
        SELECT * FROM agent_task_run
        WHERE entryId = ? AND targetLanguage = ? AND detailLevel = ? AND status = 'failed'
        ORDER BY id DESC LIMIT 1
      `)
      .get(entryId, targetLanguage, detailLevel) as SummaryRunRow | undefined;
    return row ? toSummaryRun(row) : undefined;
  }

  findResult(
    entryId: number,
    targetLanguage: SummaryTargetLanguage,
    detailLevel: SummaryDetailLevel,
  ): SummaryResult | undefined {
    const row = this.db
      .prepare(`
        SELECT * FROM summary_result
        WHERE entryId = ? AND targetLanguage = ? AND detailLevel = ?
      `)
      .get(entryId, targetLanguage, detailLevel) as SummaryResultRow | undefined;
    return row ? toSummaryResult(row) : undefined;
  }

  markRunSucceededWithResult(params: SaveSummaryResultParams): SummaryResult {
    const now = new Date().toISOString();
    const persist = this.db.transaction(() => {
      this.db
        .prepare(`
          UPDATE agent_task_run
          SET status = 'succeeded', errorCode = NULL, errorMessage = NULL,
              errorRetryable = NULL, completedAt = ?
          WHERE id = ?
        `)
        .run(now, params.runId);
      this.db
        .prepare(`
          INSERT INTO summary_result
            (runId, entryId, targetLanguage, detailLevel, inputMarkdownHash,
             promptVersion, content, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(entryId, targetLanguage, detailLevel) DO UPDATE SET
            runId = excluded.runId,
            inputMarkdownHash = excluded.inputMarkdownHash,
            promptVersion = excluded.promptVersion,
            content = excluded.content,
            updatedAt = excluded.updatedAt
        `)
        .run(
          params.runId,
          params.entryId,
          params.targetLanguage,
          params.detailLevel,
          params.inputMarkdownHash,
          params.promptVersion,
          params.content,
          now,
          now,
        );
    });
    persist();

    const result = this.findResult(
      params.entryId,
      params.targetLanguage,
      params.detailLevel,
    );
    if (!result) throw new Error('Summary result was not persisted.');
    return result;
  }

  markRunFailed(runId: number, error: ShaleError): void {
    this.db
      .prepare(`
        UPDATE agent_task_run
        SET status = 'failed', errorCode = ?, errorMessage = ?,
            errorRetryable = ?, completedAt = ?
        WHERE id = ? AND status = 'running'
      `)
      .run(error.code, error.message, error.retryable ? 1 : 0, new Date().toISOString(), runId);
  }

  reconcileInterruptedRuns(): number {
    const result = this.db
      .prepare(`
        UPDATE agent_task_run
        SET status = 'failed', errorCode = ?, errorMessage = ?, errorRetryable = 1,
            completedAt = ?
        WHERE status = 'running'
      `)
      .run(
        SUMMARY_ERROR_CODES.SUMMARY_INTERRUPTED,
        'Summary generation was interrupted before completion.',
        new Date().toISOString(),
      );
    return result.changes;
  }
}

function toSummaryRun(row: SummaryRunRow): SummaryRun {
  const error = row.errorCode && row.errorMessage
    ? {
        code: row.errorCode,
        message: row.errorMessage,
        retryable: row.errorRetryable === 1,
      }
    : undefined;
  return {
    id: row.id,
    entryId: row.entryId,
    targetLanguage: row.targetLanguage,
    detailLevel: row.detailLevel,
    status: row.status,
    error,
    createdAt: row.createdAt,
    completedAt: row.completedAt ?? undefined,
  };
}

function toSummaryResult(row: SummaryResultRow): SummaryResult {
  return {
    id: row.id,
    runId: row.runId,
    entryId: row.entryId,
    targetLanguage: row.targetLanguage,
    detailLevel: row.detailLevel,
    content: row.content,
    inputMarkdownHash: row.inputMarkdownHash,
    promptVersion: row.promptVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
