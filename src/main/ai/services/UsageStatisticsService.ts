import {
  USAGE_STATISTICS_TASK_TYPES,
  type UsageAggregate,
  type UsageStatistics,
  type UsageStatisticsByDay,
  type UsageStatisticsByModel,
  type UsageStatisticsByTaskType,
  type UsageStatisticsQuery,
  type UsageStatisticsTaskType,
} from '../../../shared/contracts/usage.types';
import type { UsageAvailability } from '../provider/ProviderTokenUsage';
import type {
  UsageStatisticsRecord,
  UsageStore,
} from '../stores/UsageStore';

type UsageStatisticsReader = Pick<UsageStore, 'listForStatistics'>;

interface UsageAggregateAccumulator {
  aggregate: UsageAggregate;
  attemptIds: Set<string>;
}

/** Aggregates persisted Provider usage only; it never estimates unreported tokens. */
export class UsageStatisticsService {
  constructor(private readonly usageStore: UsageStatisticsReader) {}

  getStatistics(query: UsageStatisticsQuery): UsageStatistics {
    const records = this.usageStore.listForStatistics(query);
    const formatter = createDayFormatter(query.timeZone);
    const totals = createAggregate();
    const byDay = new Map<string, UsageAggregateAccumulator>();
    const byTaskType = new Map<UsageStatisticsTaskType, UsageAggregateAccumulator>();
    const byModel = new Map<string, UsageAggregateAccumulator>();

    records.forEach((record) => {
      addRecord(totals, record);

      const day = formatDay(record.startedAt, formatter);
      const dayAggregate = byDay.get(day) ?? createAggregate();
      addRecord(dayAggregate, record);
      byDay.set(day, dayAggregate);

      const taskAggregate = byTaskType.get(record.taskType) ?? createAggregate();
      addRecord(taskAggregate, record);
      byTaskType.set(record.taskType, taskAggregate);

      const modelKey = `${String(record.providerProfileId)}\u0000${record.model}`;
      const modelAggregate = byModel.get(modelKey) ?? createAggregate();
      addRecord(modelAggregate, record);
      byModel.set(modelKey, modelAggregate);
    });

    return {
      query,
      totals: totals.aggregate,
      byDay: Array.from(byDay.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([day, accumulator]): UsageStatisticsByDay => ({
          day,
          ...accumulator.aggregate,
        })),
      byTaskType: USAGE_STATISTICS_TASK_TYPES.flatMap((taskType) => {
        const accumulator = byTaskType.get(taskType);
        return accumulator ? [{ taskType, ...accumulator.aggregate }] : [];
      }) as UsageStatisticsByTaskType[],
      byModel: Array.from(byModel.entries())
        .map(([key, accumulator]) => {
          const [profileId, model] = key.split('\u0000');
          return {
            providerProfileId: Number(profileId),
            model: model ?? '',
            ...accumulator.aggregate,
          } satisfies UsageStatisticsByModel;
        })
        .sort((left, right) => left.providerProfileId - right.providerProfileId
          || left.model.localeCompare(right.model)),
    };
  }
}

function createAggregate(): UsageAggregateAccumulator {
  return {
    aggregate: {
      requestCount: 0,
      requestStatus: {
        running: 0,
        succeeded: 0,
        failed: 0,
        interrupted: 0,
      },
      tokenTotals: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      tokenCoverage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        reportedRequests: 0,
        partialRequests: 0,
        missingRequests: 0,
      },
      attemptCoverage: {
        knownAttemptCount: 0,
        unassignedRequestCount: 0,
      },
    },
    attemptIds: new Set<string>(),
  };
}

function addRecord(
  accumulator: UsageAggregateAccumulator,
  record: UsageStatisticsRecord,
): void {
  const { aggregate } = accumulator;
  aggregate.requestCount += 1;
  aggregate.requestStatus[record.requestStatus] += 1;
  addToken(aggregate, 'inputTokens', record.inputTokens);
  addToken(aggregate, 'outputTokens', record.outputTokens);
  addToken(aggregate, 'totalTokens', record.totalTokens);
  addAvailability(aggregate, record.usageAvailability);
  if (record.attemptId) {
    if (!accumulator.attemptIds.has(record.attemptId)) {
      accumulator.attemptIds.add(record.attemptId);
      aggregate.attemptCoverage.knownAttemptCount += 1;
    }
  } else {
    aggregate.attemptCoverage.unassignedRequestCount += 1;
  }
}

function addToken(
  aggregate: UsageAggregate,
  field: 'inputTokens' | 'outputTokens' | 'totalTokens',
  value: number | undefined,
): void {
  if (value === undefined) return;
  aggregate.tokenTotals[field] += value;
  aggregate.tokenCoverage[field] += 1;
}

function addAvailability(aggregate: UsageAggregate, availability: UsageAvailability): void {
  if (availability === 'reported') {
    aggregate.tokenCoverage.reportedRequests += 1;
  } else if (availability === 'partial') {
    aggregate.tokenCoverage.partialRequests += 1;
  } else {
    aggregate.tokenCoverage.missingRequests += 1;
  }
}

function createDayFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function formatDay(timestamp: string, formatter: Intl.DateTimeFormat): string {
  const parts = formatter.formatToParts(new Date(timestamp));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year') ?? ''}-${values.get('month') ?? ''}-${values.get('day') ?? ''}`;
}
