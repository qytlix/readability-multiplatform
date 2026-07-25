import { useEffect, useState } from 'react';
import type {
  UsageAggregate,
  UsageStatistics,
  UsageStatisticsQuery,
  UsageTokenTotals,
} from '../../../shared/contracts/usage.types';

const RANGE_OPTIONS = [7, 30, 90] as const;
const DEFAULT_RANGE_DAYS = 30;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const numberFormatter = new Intl.NumberFormat();

type UsageRangeDays = (typeof RANGE_OPTIONS)[number];
type UsageLoadState = 'loading' | 'ready' | 'error';
type TokenField = keyof UsageTokenTotals;

interface UsageBreakdownRow {
  key: string;
  label: string;
  aggregate: UsageAggregate;
}

/** Read-only settings view for the persisted Provider usage ledger. */
export const UsageStatisticsSection = () => {
  const [rangeDays, setRangeDays] = useState<UsageRangeDays>(DEFAULT_RANGE_DAYS);
  const [loadState, setLoadState] = useState<UsageLoadState>('loading');
  const [statistics, setStatistics] = useState<UsageStatistics>();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const timeZone = getSystemTimeZone();

  useEffect(() => {
    let disposed = false;
    const query = createStatisticsQuery(rangeDays, timeZone);

    const load = async (): Promise<void> => {
      setLoadState('loading');
      setStatistics(undefined);
      if (!window.shaleAPI?.usage) {
        if (!disposed) setLoadState('error');
        return;
      }

      try {
        const result = await window.shaleAPI.usage.getStatistics(query);
        if (disposed) return;
        if (!result.ok) {
          setLoadState('error');
          return;
        }
        setStatistics(result.data);
        setLoadState('ready');
      } catch {
        if (!disposed) setLoadState('error');
      }
    };

    void load();
    return () => {
      disposed = true;
    };
  }, [rangeDays, refreshVersion, timeZone]);

  const retry = (): void => {
    setRefreshVersion((version) => version + 1);
  };

  return (
    <section className="settings-section" aria-labelledby="usage-statistics-title">
      <h3 id="usage-statistics-title" className="settings-section-title">Usage Statistics</h3>
      <div className="settings-card usage-statistics-card">
        <div className="usage-statistics-header">
          <p>
            Provider-reported token usage for Summary and full-article Translation.
            Daily totals use {statistics?.query.timeZone ?? timeZone}.
          </p>
          <div className="usage-range-selector" aria-label="Usage statistics date range">
            {RANGE_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                className={rangeDays === days ? 'is-selected' : ''}
                aria-pressed={rangeDays === days}
                onClick={() => setRangeDays(days)}
              >
                {days} days
              </button>
            ))}
          </div>
        </div>

        {loadState === 'loading' && (
          <p className="usage-statistics-state" role="status">Loading usage statistics…</p>
        )}

        {loadState === 'error' && (
          <div className="usage-statistics-error" role="alert">
            <p>Unable to load usage statistics. Try again.</p>
            <button type="button" onClick={retry}>Retry</button>
          </div>
        )}

        {loadState === 'ready' && statistics && (
          <UsageStatisticsContent statistics={statistics} />
        )}
      </div>
    </section>
  );
};

const UsageStatisticsContent = ({ statistics }: { statistics: UsageStatistics }) => {
  const { totals } = statistics;
  if (totals.requestCount === 0) {
    return (
      <p className="usage-statistics-state" role="status">
        No Provider requests were recorded for the selected period.
      </p>
    );
  }

  const hasIncompleteUsage = totals.tokenCoverage.partialRequests > 0
    || totals.tokenCoverage.missingRequests > 0;
  const hasUnassignedRequests = totals.attemptCoverage.unassignedRequestCount > 0;

  return (
    <div className="usage-statistics-content">
      <div className="usage-statistics-summary" aria-label="Usage totals">
        <UsageTokenMetric aggregate={totals} field="totalTokens" label="Provider-reported total tokens" />
        <UsageTokenMetric aggregate={totals} field="inputTokens" label="Input tokens" />
        <UsageTokenMetric aggregate={totals} field="outputTokens" label="Output tokens" />
        <UsageMetric
          label="Provider requests"
          value={formatNumber(totals.requestCount)}
          detail="Each record represents one real Provider request."
        />
        <UsageMetric
          label="Known executions"
          value={formatNumber(totals.attemptCoverage.knownAttemptCount)}
          detail={hasUnassignedRequests
            ? `${formatNumber(totals.attemptCoverage.unassignedRequestCount)} historical ${pluralize('request', totals.attemptCoverage.unassignedRequestCount)} without an execution identity.`
            : 'Distinct Summary or full-article Translation attempts.'}
        />
      </div>

      {(hasIncompleteUsage || hasUnassignedRequests) && (
        <p className="usage-statistics-coverage-note" role="status">
          These totals are not a complete estimate. Only token fields explicitly reported by
          the Provider are summed; missing fields are not treated as zero.
          {hasIncompleteUsage && ` ${formatNumber(
            totals.tokenCoverage.partialRequests + totals.tokenCoverage.missingRequests,
          )} ${pluralize(
            'request', totals.tokenCoverage.partialRequests + totals.tokenCoverage.missingRequests,
          )} reported partial or missing usage.`}
          {hasUnassignedRequests && ` ${formatNumber(
            totals.attemptCoverage.unassignedRequestCount,
          )} historical ${pluralize(
            'request', totals.attemptCoverage.unassignedRequestCount,
          )} cannot be assigned to an execution.`}
        </p>
      )}

      <div className="usage-statistics-breakdowns">
        <UsageBreakdownTable
          title="By day"
          firstColumn="Date"
          rows={statistics.byDay.map((item) => ({
            key: item.day,
            label: item.day,
            aggregate: item,
          }))}
        />
        <UsageBreakdownTable
          title="By feature"
          firstColumn="Feature"
          rows={statistics.byTaskType.map((item) => ({
            key: item.taskType,
            label: item.taskType === 'summary' ? 'Summary' : 'Full translation',
            aggregate: item,
          }))}
        />
        <UsageBreakdownTable
          title="By Provider and model"
          firstColumn="Provider + model"
          rows={statistics.byModel.map((item) => ({
            key: `${String(item.providerProfileId)}\u0000${item.model}`,
            label: `Provider #${String(item.providerProfileId)} · ${item.model}`,
            aggregate: item,
          }))}
        />
      </div>
    </div>
  );
};

const UsageTokenMetric = ({
  aggregate,
  field,
  label,
}: {
  aggregate: UsageAggregate;
  field: TokenField;
  label: string;
}) => {
  const reportedRequests = aggregate.tokenCoverage[field];
  const value = reportedRequests === 0
    ? 'Not reported'
    : formatNumber(aggregate.tokenTotals[field]);
  const detail = reportedRequests === 0
    ? 'No requests reported this token field.'
    : `Reported by ${formatNumber(reportedRequests)} of ${formatNumber(aggregate.requestCount)} ${pluralize('request', aggregate.requestCount)}.`;

  return <UsageMetric label={label} value={value} detail={detail} />;
};

const UsageMetric = ({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) => (
  <div className="usage-statistics-metric">
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{detail}</small>
  </div>
);

const UsageBreakdownTable = ({
  title,
  firstColumn,
  rows,
}: {
  title: string;
  firstColumn: string;
  rows: UsageBreakdownRow[];
}) => (
  <section className="usage-statistics-breakdown" aria-label={title}>
    <h4>{title}</h4>
    <div className="usage-statistics-table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">{firstColumn}</th>
            <th scope="col">Input</th>
            <th scope="col">Output</th>
            <th scope="col">Total</th>
            <th scope="col">Requests</th>
            <th scope="col">Executions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <UsageTokenCell aggregate={row.aggregate} field="inputTokens" />
              <UsageTokenCell aggregate={row.aggregate} field="outputTokens" />
              <UsageTokenCell aggregate={row.aggregate} field="totalTokens" />
              <td>{formatNumber(row.aggregate.requestCount)}</td>
              <td>{formatNumber(row.aggregate.attemptCoverage.knownAttemptCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);

const UsageTokenCell = ({
  aggregate,
  field,
}: {
  aggregate: UsageAggregate;
  field: TokenField;
}) => {
  const isReported = aggregate.tokenCoverage[field] > 0;
  return (
    <td title={isReported ? undefined : 'Not reported by any request in this group'}>
      {isReported ? formatNumber(aggregate.tokenTotals[field]) : '—'}
    </td>
  );
};

function createStatisticsQuery(rangeDays: UsageRangeDays, timeZone: string): UsageStatisticsQuery {
  const endAt = new Date();
  return {
    startAt: new Date(endAt.getTime() - rangeDays * MILLIS_PER_DAY).toISOString(),
    endAt: endAt.toISOString(),
    timeZone,
  };
}

function getSystemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}
