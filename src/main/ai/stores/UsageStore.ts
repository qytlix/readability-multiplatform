import type Database from 'better-sqlite3';
import type {
  ProviderTokenUsage,
  UsageAvailability,
} from '../provider/ProviderTokenUsage';
import {
  getUsageAvailability,
  sanitizeProviderTokenUsage,
} from '../provider/ProviderTokenUsage';

export const USAGE_TASK_TYPES = ['summary', 'translation'] as const;
export type UsageTaskType = (typeof USAGE_TASK_TYPES)[number];

export const USAGE_REQUEST_KINDS = ['summary', 'batch', 'compensation'] as const;
export type UsageRequestKind = (typeof USAGE_REQUEST_KINDS)[number];

export const USAGE_REQUEST_STATUSES = [
  'running',
  'succeeded',
  'failed',
  'interrupted',
] as const;
export type UsageRequestStatus = (typeof USAGE_REQUEST_STATUSES)[number];

export interface UsageRequestRecord extends ProviderTokenUsage {
  id: number;
  providerRequestId: number;
  attemptId?: string;
  taskType: UsageTaskType;
  taskRunId: number;
  providerProfileId: number;
  model: string;
  requestKind: UsageRequestKind;
  requestStatus: UsageRequestStatus;
  errorCode?: string;
  usageAvailability: UsageAvailability;
  startedAt: string;
  finishedAt?: string;
}

export interface StartUsageRequestParams {
  providerRequestId: number;
  attemptId: string;
  taskType: UsageTaskType;
  taskRunId: number;
  providerProfileId: number;
  model: string;
  requestKind: UsageRequestKind;
}

export interface UsageStatisticsQueryParams {
  startAt: string;
  endAt: string;
  taskType?: UsageTaskType;
  providerProfileId?: number;
  model?: string;
}

export interface UsageStatisticsRecord extends ProviderTokenUsage {
  attemptId?: string;
  taskType: UsageTaskType;
  providerProfileId: number;
  model: string;
  requestStatus: UsageRequestStatus;
  usageAvailability: UsageAvailability;
  startedAt: string;
}

export class UsageStore {
  constructor(private readonly db: Database.Database) {}

  createRunning(params: StartUsageRequestParams): UsageRequestRecord {
    const startedAt = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO llm_usage_event
        (providerRequestId, attemptId, taskType, taskRunId, providerProfileId, model,
         requestKind, requestStatus, usageAvailability, startedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'running', 'missing', ?)
    `).run(
      params.providerRequestId,
      params.attemptId,
      params.taskType,
      params.taskRunId,
      params.providerProfileId,
      params.model,
      params.requestKind,
      startedAt,
    );
    const record = this.findByProviderRequestId(params.providerRequestId);
    if (!record) throw new Error(`Usage event ${String(result.lastInsertRowid)} was not persisted.`);
    return record;
  }

  finish(
    providerRequestId: number,
    requestStatus: Exclude<UsageRequestStatus, 'running'>,
    usage: ProviderTokenUsage | undefined,
    errorCode?: string,
  ): void {
    const safeUsage = sanitizeProviderTokenUsage(usage);
    this.db.prepare(`
      UPDATE llm_usage_event
      SET requestStatus = ?, errorCode = ?, inputTokens = ?, outputTokens = ?,
          totalTokens = ?, usageAvailability = ?, finishedAt = ?
      WHERE providerRequestId = ? AND requestStatus = 'running'
    `).run(
      requestStatus,
      errorCode ?? null,
      safeUsage?.inputTokens ?? null,
      safeUsage?.outputTokens ?? null,
      safeUsage?.totalTokens ?? null,
      getUsageAvailability(safeUsage),
      new Date().toISOString(),
      providerRequestId,
    );
  }

  reconcileInterruptedRunning(): number {
    const now = new Date().toISOString();
    return this.db.prepare(`
      UPDATE llm_usage_event
      SET requestStatus = 'interrupted', errorCode = 'AI_INTERRUPTED', finishedAt = ?
      WHERE requestStatus = 'running'
    `).run(now).changes;
  }

  findByProviderRequestId(providerRequestId: number): UsageRequestRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM llm_usage_event WHERE providerRequestId = ?
    `).get(providerRequestId) as UsageRequestRow | undefined;
    return row ? toUsageRequestRecord(row) : undefined;
  }

  listByTask(taskType: UsageTaskType, taskRunId: number): UsageRequestRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM llm_usage_event
      WHERE taskType = ? AND taskRunId = ?
      ORDER BY startedAt ASC, id ASC
    `).all(taskType, taskRunId) as UsageRequestRow[];
    return rows.map(toUsageRequestRecord);
  }

  listForStatistics(params: UsageStatisticsQueryParams): UsageStatisticsRecord[] {
    const clauses = ['startedAt >= ?', 'startedAt < ?'];
    const values: Array<string | number> = [params.startAt, params.endAt];
    if (params.taskType) {
      clauses.push('taskType = ?');
      values.push(params.taskType);
    }
    if (params.providerProfileId !== undefined) {
      clauses.push('providerProfileId = ?');
      values.push(params.providerProfileId);
    }
    if (params.model !== undefined) {
      clauses.push('model = ?');
      values.push(params.model);
    }
    const rows = this.db.prepare(`
      SELECT attemptId, taskType, providerProfileId, model, requestStatus, usageAvailability,
             inputTokens, outputTokens, totalTokens, startedAt
      FROM llm_usage_event
      WHERE ${clauses.join(' AND ')}
      ORDER BY startedAt ASC, id ASC
    `).all(...values) as UsageStatisticsRow[];
    return rows.map(toUsageStatisticsRecord);
  }
}

interface UsageRequestRow {
  id: number;
  providerRequestId: number;
  attemptId: string | null;
  taskType: UsageTaskType;
  taskRunId: number;
  providerProfileId: number;
  model: string;
  requestKind: UsageRequestKind;
  requestStatus: UsageRequestStatus;
  errorCode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  usageAvailability: UsageAvailability;
  startedAt: string;
  finishedAt: string | null;
}

interface UsageStatisticsRow {
  attemptId: string | null;
  taskType: UsageTaskType;
  providerProfileId: number;
  model: string;
  requestStatus: UsageRequestStatus;
  usageAvailability: UsageAvailability;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  startedAt: string;
}

function toUsageRequestRecord(row: UsageRequestRow): UsageRequestRecord {
  return {
    id: row.id,
    providerRequestId: row.providerRequestId,
    ...(row.attemptId ? { attemptId: row.attemptId } : {}),
    taskType: row.taskType,
    taskRunId: row.taskRunId,
    providerProfileId: row.providerProfileId,
    model: row.model,
    requestKind: row.requestKind,
    requestStatus: row.requestStatus,
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    ...(row.inputTokens === null ? {} : { inputTokens: row.inputTokens }),
    ...(row.outputTokens === null ? {} : { outputTokens: row.outputTokens }),
    ...(row.totalTokens === null ? {} : { totalTokens: row.totalTokens }),
    usageAvailability: row.usageAvailability,
    startedAt: row.startedAt,
    ...(row.finishedAt ? { finishedAt: row.finishedAt } : {}),
  };
}

function toUsageStatisticsRecord(row: UsageStatisticsRow): UsageStatisticsRecord {
  return {
    ...(row.attemptId ? { attemptId: row.attemptId } : {}),
    taskType: row.taskType,
    providerProfileId: row.providerProfileId,
    model: row.model,
    requestStatus: row.requestStatus,
    usageAvailability: row.usageAvailability,
    ...(row.inputTokens === null ? {} : { inputTokens: row.inputTokens }),
    ...(row.outputTokens === null ? {} : { outputTokens: row.outputTokens }),
    ...(row.totalTokens === null ? {} : { totalTokens: row.totalTokens }),
    startedAt: row.startedAt,
  };
}
