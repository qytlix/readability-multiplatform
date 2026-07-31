export const USAGE_STATISTICS_TASK_TYPES = ['summary', 'translation', 'chat'] as const;
export type UsageStatisticsTaskType = (typeof USAGE_STATISTICS_TASK_TYPES)[number];

export interface UsageStatisticsQuery {
  /** Inclusive ISO-8601 lower bound, normalized to UTC by Main IPC. */
  startAt: string;
  /** Exclusive ISO-8601 upper bound, normalized to UTC by Main IPC. */
  endAt: string;
  /** IANA time zone used solely for `byDay` bucketing. */
  timeZone: string;
  taskType?: UsageStatisticsTaskType;
  providerProfileId?: number;
  model?: string;
}

export interface UsageTokenTotals {
  /** Sum of only the requests that explicitly reported this field. */
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UsageTokenCoverage {
  /** Requests that explicitly reported each corresponding token field. */
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reportedRequests: number;
  partialRequests: number;
  missingRequests: number;
}

export interface UsageRequestStatusCounts {
  running: number;
  succeeded: number;
  failed: number;
  interrupted: number;
}

/**
 * Execution attribution is based only on non-null `attemptId` values. Older
 * ledger rows predate attempts and are counted separately rather than guessed.
 */
export interface UsageAttemptCoverage {
  knownAttemptCount: number;
  unassignedRequestCount: number;
}

export interface UsageAggregate {
  requestCount: number;
  requestStatus: UsageRequestStatusCounts;
  tokenTotals: UsageTokenTotals;
  tokenCoverage: UsageTokenCoverage;
  attemptCoverage: UsageAttemptCoverage;
}

export interface UsageStatisticsByDay extends UsageAggregate {
  day: string;
}

export interface UsageStatisticsByTaskType extends UsageAggregate {
  taskType: UsageStatisticsTaskType;
}

/** `model` is deliberately scoped by profile, not globally by model text. */
export interface UsageStatisticsByModel extends UsageAggregate {
  providerProfileId: number;
  model: string;
}

export interface UsageStatistics {
  query: UsageStatisticsQuery;
  totals: UsageAggregate;
  byDay: UsageStatisticsByDay[];
  byTaskType: UsageStatisticsByTaskType[];
  byModel: UsageStatisticsByModel[];
}
