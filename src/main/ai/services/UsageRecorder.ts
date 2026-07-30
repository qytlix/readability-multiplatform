import { randomUUID } from 'node:crypto';
import {
  getUsageAvailability,
  sanitizeProviderTokenUsage,
  type ProviderTokenUsage,
} from '../provider/ProviderTokenUsage';
import type {
  StartUsageRequestParams,
  UsageRequestRecord,
  UsageRequestStatus,
  UsageTaskType,
} from '../stores/UsageStore';
import { UsageStore } from '../stores/UsageStore';

export const USAGE_LEDGER_LOG_EVENTS = {
  persistenceFailed: 'usage.ledger.persistence.failed',
} as const;

export const USAGE_LEDGER_LOG_COMPONENT = 'usage.ledger';

export interface UsageLedgerOperationLogger {
  error(
    event: typeof USAGE_LEDGER_LOG_EVENTS.persistenceFailed,
    component: typeof USAGE_LEDGER_LOG_COMPONENT,
    context: {
      taskRunId?: number;
      providerRequestId?: number;
      stage: 'start' | 'finish' | 'reconcile';
      errorCode: 'USAGE_LEDGER_PERSISTENCE_FAILED';
    },
  ): void;
}

export interface UsageRequestHandle {
  providerRequestId: number;
  attemptId: string;
  taskRunId: number;
  persisted: boolean;
  settled: boolean;
}

let latestProviderRequestId = 0;

/** Generates process-unique numeric request IDs shared by Summary and Translation. */
export function createProviderRequestId(): number {
  const timestampBasedId = Date.now() * 1_000;
  latestProviderRequestId = Math.max(latestProviderRequestId + 1, timestampBasedId);
  return latestProviderRequestId;
}

/** Generates an opaque identity shared by every Provider request in one AI attempt. */
export function createUsageAttemptId(): string {
  return randomUUID();
}

/**
 * Best-effort ledger persistence. Every method absorbs Store errors so that
 * usage accounting can never alter an AI task's existing outcome.
 */
export class UsageRecorder {
  constructor(
    private readonly usageStore: UsageStore,
    private readonly logger?: UsageLedgerOperationLogger,
  ) {}

  start(params: StartUsageRequestParams): UsageRequestHandle {
    const handle: UsageRequestHandle = {
      providerRequestId: params.providerRequestId,
      attemptId: params.attemptId,
      taskRunId: params.taskRunId,
      persisted: false,
      settled: false,
    };
    try {
      this.usageStore.createRunning(params);
      handle.persisted = true;
    } catch {
      this.logPersistenceFailure(handle, 'start');
    }
    return handle;
  }

  complete(handle: UsageRequestHandle, usage: ProviderTokenUsage | undefined): void {
    this.finish(handle, 'succeeded', usage);
  }

  fail(
    handle: UsageRequestHandle,
    errorCode: string,
    usage: ProviderTokenUsage | undefined,
  ): void {
    this.finish(handle, 'failed', usage, errorCode);
  }

  interrupt(
    handle: UsageRequestHandle,
    usage?: ProviderTokenUsage,
    errorCode = 'AI_INTERRUPTED',
  ): void {
    this.finish(handle, 'interrupted', usage, errorCode);
  }

  reconcileInterruptedRunning(): number {
    try {
      return this.usageStore.reconcileInterruptedRunning();
    } catch {
      this.logPersistenceFailure(undefined, 'reconcile');
      return 0;
    }
  }

  listByAttempt(
    taskType: UsageTaskType,
    taskRunId: number,
    attemptId: string,
  ): UsageRequestRecord[] {
    try {
      return this.usageStore.listByAttempt(taskType, taskRunId, attemptId);
    } catch {
      return [];
    }
  }

  private finish(
    handle: UsageRequestHandle,
    requestStatus: Exclude<UsageRequestStatus, 'running'>,
    usage: ProviderTokenUsage | undefined,
    errorCode?: string,
  ): void {
    if (handle.settled) return;
    handle.settled = true;
    if (!handle.persisted) return;
    try {
      this.usageStore.finish(handle.providerRequestId, requestStatus, usage, errorCode);
    } catch {
      this.logPersistenceFailure(handle, 'finish');
    }
  }

  private logPersistenceFailure(
    handle: Pick<UsageRequestHandle, 'taskRunId' | 'providerRequestId'> | undefined,
    stage: 'start' | 'finish' | 'reconcile',
  ): void {
    try {
      this.logger?.error(USAGE_LEDGER_LOG_EVENTS.persistenceFailed, USAGE_LEDGER_LOG_COMPONENT, {
        ...(handle ? { taskRunId: handle.taskRunId } : {}),
        ...(handle ? { providerRequestId: handle.providerRequestId } : {}),
        stage,
        errorCode: 'USAGE_LEDGER_PERSISTENCE_FAILED',
      });
    } catch {
      // Accounting diagnostics must not change AI task behavior.
    }
  }
}

/** Non-persisting in-memory test seam that retains Usage semantics for diagnostics. */
export class NoopUsageRecorder {
  private readonly records = new Map<number, UsageRequestRecord>();

  start(params: StartUsageRequestParams): UsageRequestHandle {
    this.records.set(params.providerRequestId, {
      id: params.providerRequestId,
      providerRequestId: params.providerRequestId,
      attemptId: params.attemptId,
      taskType: params.taskType,
      taskRunId: params.taskRunId,
      providerProfileId: params.providerProfileId,
      model: params.model,
      requestKind: params.requestKind,
      requestStatus: 'running',
      usageAvailability: 'missing',
      startedAt: new Date().toISOString(),
    });
    return {
      providerRequestId: params.providerRequestId,
      attemptId: params.attemptId,
      taskRunId: params.taskRunId,
      persisted: true,
      settled: false,
    };
  }

  complete(handle: UsageRequestHandle, usage: ProviderTokenUsage | undefined): void {
    this.finish(handle, 'succeeded', usage);
  }

  fail(
    handle: UsageRequestHandle,
    errorCode: string,
    usage: ProviderTokenUsage | undefined,
  ): void {
    this.finish(handle, 'failed', usage, errorCode);
  }

  interrupt(
    handle: UsageRequestHandle,
    usage?: ProviderTokenUsage,
    errorCode = 'AI_INTERRUPTED',
  ): void {
    this.finish(handle, 'interrupted', usage, errorCode);
  }

  reconcileInterruptedRunning(): number {
    return 0;
  }

  listByAttempt(
    taskType: UsageTaskType,
    taskRunId: number,
    attemptId: string,
  ): UsageRequestRecord[] {
    return [...this.records.values()].filter((record) =>
      record.taskType === taskType
      && record.taskRunId === taskRunId
      && record.attemptId === attemptId);
  }

  private finish(
    handle: UsageRequestHandle,
    requestStatus: Exclude<UsageRequestStatus, 'running'>,
    usage: ProviderTokenUsage | undefined,
    errorCode?: string,
  ): void {
    if (handle.settled) return;
    handle.settled = true;
    const record = this.records.get(handle.providerRequestId);
    if (!record) return;
    const safeUsage = sanitizeProviderTokenUsage(usage);
    this.records.set(handle.providerRequestId, {
      ...record,
      requestStatus,
      ...(errorCode ? { errorCode } : {}),
      ...(safeUsage ?? {}),
      usageAvailability: getUsageAvailability(safeUsage),
      finishedAt: new Date().toISOString(),
    });
  }
}

export type UsageRecorderPort = Pick<
  UsageRecorder,
  'start' | 'complete' | 'fail' | 'interrupt' | 'reconcileInterruptedRunning' | 'listByAttempt'
>;
