import { useEffect, useState } from 'react';
import type {
  UsageAggregate,
  UsageStatistics,
  UsageStatisticsByDay,
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
type UsageTrendView = 'tokens' | 'requests';
type TokenCoverageState = 'no-requests' | 'complete' | 'partial' | 'not-reported';

const CHART_WIDTH = 720;
const CHART_HEIGHT = 224;
const CHART_PADDING = {
  top: 16,
  right: 18,
  bottom: 39,
  left: 54,
};

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

      <UsageTrendsCard statistics={statistics} />

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

const UsageTrendsCard = ({ statistics }: { statistics: UsageStatistics }) => {
  const [view, setView] = useState<UsageTrendView>('tokens');
  const [activePoint, setActivePoint] = useState<UsageTrendPoint>();
  const points = createUsageTrendPoints(statistics);

  const selectView = (nextView: UsageTrendView): void => {
    setView(nextView);
    setActivePoint(undefined);
  };

  return (
    <section className="usage-trends-card" aria-labelledby="usage-trends-title">
      <div className="usage-trends-header">
        <div>
          <h4 id="usage-trends-title">Usage Trends</h4>
          <p>Daily buckets use {statistics.query.timeZone}.</p>
        </div>
        <div className="usage-trend-view-selector" aria-label="Usage trend metric">
          <button
            type="button"
            className={view === 'tokens' ? 'is-selected' : ''}
            aria-pressed={view === 'tokens'}
            onClick={() => selectView('tokens')}
          >
            Reported Tokens
          </button>
          <button
            type="button"
            className={view === 'requests' ? 'is-selected' : ''}
            aria-pressed={view === 'requests'}
            onClick={() => selectView('requests')}
          >
            Requests
          </button>
        </div>
      </div>

      <UsageTrendChart
        points={points}
        view={view}
        activePoint={activePoint}
        onActivatePoint={setActivePoint}
        onDeactivatePoint={() => setActivePoint(undefined)}
      />
    </section>
  );
};

const UsageTrendChart = ({
  points,
  view,
  activePoint,
  onActivatePoint,
  onDeactivatePoint,
}: {
  points: UsageTrendPoint[];
  view: UsageTrendView;
  activePoint?: UsageTrendPoint;
  onActivatePoint: (point: UsageTrendPoint) => void;
  onDeactivatePoint: () => void;
}) => {
  const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const plotBottom = CHART_HEIGHT - CHART_PADDING.bottom;
  const maxValue = Math.max(
    1,
    ...points.map((point) => view === 'tokens'
      ? point.aggregate?.tokenTotals.totalTokens ?? 0
      : point.aggregate?.requestCount ?? 0),
  );
  const scaleMaximum = roundChartMaximum(maxValue);
  const yTicks = createYAxisTicks(scaleMaximum);
  const xLabels = createXAxisLabelIndexes(points.length);
  const slotWidth = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.max(1.5, Math.min(20, slotWidth * 0.64));
  const getX = (index: number): number => CHART_PADDING.left + (index + 0.5) * slotWidth;
  const getY = (value: number): number => plotBottom - (value / scaleMaximum) * plotHeight;
  const areaPath = view === 'requests' ? createAreaPath(points, getX, getY, plotBottom) : undefined;
  const linePath = view === 'requests' ? createLinePath(points, getX, getY) : undefined;

  return (
    <div className="usage-trend-chart-shell">
      <svg
        className={`usage-trend-chart usage-trend-chart-${view}`}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label={`${view === 'tokens' ? 'Provider-reported total token' : 'Provider request'} trend by day`}
        onMouseLeave={onDeactivatePoint}
      >
        {yTicks.map((tick) => {
          const y = getY(tick);
          return (
            <g key={tick} className="usage-trend-grid-line">
              <line x1={CHART_PADDING.left} x2={CHART_WIDTH - CHART_PADDING.right} y1={y} y2={y} />
              <text x={CHART_PADDING.left - 9} y={y + 4} textAnchor="end">
                {formatAxisValue(tick)}
              </text>
            </g>
          );
        })}

        {view === 'requests' && areaPath && linePath && (
          <>
            <path className="usage-trend-area" d={areaPath} />
            <path className="usage-trend-line" d={linePath} />
          </>
        )}

        {points.map((point, index) => {
          const aggregate = point.aggregate;
          const value = view === 'tokens'
            ? aggregate?.tokenTotals.totalTokens ?? 0
            : aggregate?.requestCount ?? 0;
          const x = getX(index);
          const coverage = getTokenCoverageState(aggregate);
          const y = getY(value);
          const hasReportedZero = view === 'tokens' && coverage === 'complete' && value === 0;

          return (
            <g key={point.day} className="usage-trend-point">
              {view === 'tokens' && coverage !== 'no-requests' && coverage !== 'not-reported' && (
                <rect
                  className={`usage-trend-bar is-${coverage}${hasReportedZero ? ' is-zero' : ''}`}
                  x={x - barWidth / 2}
                  y={hasReportedZero ? plotBottom - 2 : y}
                  width={barWidth}
                  height={hasReportedZero ? 2 : Math.max(0, plotBottom - y)}
                  rx={Math.min(2, barWidth / 2)}
                />
              )}
              {view === 'tokens' && coverage === 'not-reported' && (
                <path
                  className="usage-trend-unreported-marker"
                  d={`M ${x - 3} ${plotBottom - 6} L ${x + 3} ${plotBottom} M ${x + 3} ${plotBottom - 6} L ${x - 3} ${plotBottom}`}
                />
              )}
              {view === 'requests' && (
                <circle className="usage-trend-line-point" cx={x} cy={y} r={points.length > 45 ? 2 : 3} />
              )}
              <rect
                className="usage-trend-hit-target"
                data-day={point.day}
                data-coverage={coverage}
                x={CHART_PADDING.left + index * slotWidth}
                y={CHART_PADDING.top}
                width={slotWidth}
                height={plotHeight}
                role="button"
                tabIndex={0}
                aria-label={createPointAriaLabel(point, view)}
                onMouseEnter={() => onActivatePoint(point)}
                onFocus={() => onActivatePoint(point)}
                onBlur={onDeactivatePoint}
                onPointerDown={() => onActivatePoint(point)}
              />
            </g>
          );
        })}

        {xLabels.map((index) => {
          const point = points[index];
          if (!point) return null;
          return (
            <text
              key={point.day}
              className="usage-trend-x-label"
              x={getX(index)}
              y={CHART_HEIGHT - 13}
              textAnchor="middle"
            >
              {formatShortDay(point.day)}
            </text>
          );
        })}
      </svg>

      {activePoint && (
        <UsageTrendTooltip point={activePoint} view={view} />
      )}

      {view === 'tokens' && (
        <p className="usage-trend-legend">
          Bars show reported total tokens. Amber bars have partial total-token coverage;
          crossed markers mean requests were recorded but total tokens were not reported.
          Blank dates had no Provider requests.
        </p>
      )}
    </div>
  );
};

const UsageTrendTooltip = ({
  point,
  view,
}: {
  point: UsageTrendPoint;
  view: UsageTrendView;
}) => {
  const aggregate = point.aggregate;
  return (
    <div className="usage-trend-tooltip" role="status">
      <strong>{point.day}</strong>
      {view === 'requests' ? (
        <span>Requests: {formatNumber(aggregate?.requestCount ?? 0)}</span>
      ) : aggregate ? (
        <>
          <span>Provider-reported total tokens: {formatTrendTokenValue(aggregate, 'totalTokens')}</span>
          <span>Input tokens: {formatTrendTokenValue(aggregate, 'inputTokens')}</span>
          <span>Output tokens: {formatTrendTokenValue(aggregate, 'outputTokens')}</span>
          <span>Token coverage: {formatTokenCoverage(aggregate)}</span>
        </>
      ) : (
        <span>No Provider requests were recorded.</span>
      )}
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

interface UsageTrendPoint {
  day: string;
  aggregate?: UsageStatisticsByDay;
}

function createUsageTrendPoints(statistics: UsageStatistics): UsageTrendPoint[] {
  const daysByDate = new Map(statistics.byDay.map((item) => [item.day, item]));
  const startDay = formatDayInTimeZone(statistics.query.startAt, statistics.query.timeZone);
  const endDay = formatDayInTimeZone(statistics.query.endAt, statistics.query.timeZone);
  const days = createDayRange(startDay, endDay);

  if (days.length === 0) {
    return statistics.byDay.map((item) => ({ day: item.day, aggregate: item }));
  }

  return days.map((day) => ({ day, aggregate: daysByDate.get(day) }));
}

function formatDayInTimeZone(timestamp: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year') ?? ''}-${values.get('month') ?? ''}-${values.get('day') ?? ''}`;
}

function createDayRange(startDay: string, endDay: string): string[] {
  if (startDay > endDay) return [];
  const [startYear, startMonth, startDate] = startDay.split('-').map(Number);
  const [endYear, endMonth, endDate] = endDay.split('-').map(Number);
  if (![startYear, startMonth, startDate, endYear, endMonth, endDate].every(Number.isFinite)) {
    return [];
  }

  const cursor = new Date(Date.UTC(startYear, startMonth - 1, startDate));
  const end = new Date(Date.UTC(endYear, endMonth - 1, endDate));
  const days: string[] = [];
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function getTokenCoverageState(aggregate?: UsageAggregate): TokenCoverageState {
  if (!aggregate || aggregate.requestCount === 0) return 'no-requests';
  const totalTokenReports = aggregate.tokenCoverage.totalTokens;
  if (totalTokenReports === aggregate.requestCount) return 'complete';
  if (totalTokenReports === 0) return 'not-reported';
  return 'partial';
}

function formatTrendTokenValue(aggregate: UsageAggregate, field: TokenField): string {
  const reportedRequests = aggregate.tokenCoverage[field];
  if (reportedRequests === 0) return 'Not reported';
  return `${formatNumber(aggregate.tokenTotals[field])} (reported by ${formatNumber(reportedRequests)} of ${formatNumber(aggregate.requestCount)} ${pluralize('request', aggregate.requestCount)})`;
}

function formatTokenCoverage(aggregate: UsageAggregate): string {
  const reportedRequests = aggregate.tokenCoverage.totalTokens;
  const coverage = getTokenCoverageState(aggregate);
  if (coverage === 'complete') {
    return `Complete (${formatNumber(reportedRequests)} of ${formatNumber(aggregate.requestCount)} ${pluralize('request', aggregate.requestCount)} reported total tokens)`;
  }
  if (coverage === 'partial') {
    return `Partial (${formatNumber(reportedRequests)} of ${formatNumber(aggregate.requestCount)} ${pluralize('request', aggregate.requestCount)} reported total tokens)`;
  }
  return `Not reported (0 of ${formatNumber(aggregate.requestCount)} ${pluralize('request', aggregate.requestCount)} reported total tokens)`;
}

function createPointAriaLabel(point: UsageTrendPoint, view: UsageTrendView): string {
  const aggregate = point.aggregate;
  if (!aggregate) return `${point.day}: no Provider requests`;
  if (view === 'requests') return `${point.day}: ${formatNumber(aggregate.requestCount)} ${pluralize('request', aggregate.requestCount)}`;
  return `${point.day}: ${formatTrendTokenValue(aggregate, 'totalTokens')}; ${formatTokenCoverage(aggregate)}`;
}

function roundChartMaximum(value: number): number {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function createYAxisTicks(maximum: number): number[] {
  return [maximum, maximum * (2 / 3), maximum / 3, 0];
}

function createXAxisLabelIndexes(pointCount: number): number[] {
  if (pointCount === 0) return [];
  const labelCount = Math.min(pointCount, pointCount <= 7 ? pointCount : pointCount <= 30 ? 5 : 6);
  return Array.from(new Set(Array.from({ length: labelCount }, (_, index) => (
    Math.round((index * (pointCount - 1)) / Math.max(labelCount - 1, 1))
  ))));
}

function createLinePath(
  points: UsageTrendPoint[],
  getX: (index: number) => number,
  getY: (value: number) => number,
): string {
  return points.map((point, index) => {
    const value = point.aggregate?.requestCount ?? 0;
    return `${index === 0 ? 'M' : 'L'} ${getX(index)} ${getY(value)}`;
  }).join(' ');
}

function createAreaPath(
  points: UsageTrendPoint[],
  getX: (index: number) => number,
  getY: (value: number) => number,
  plotBottom: number,
): string {
  if (points.length === 0) return '';
  const linePath = createLinePath(points, getX, getY);
  return `${linePath} L ${getX(points.length - 1)} ${plotBottom} L ${getX(0)} ${plotBottom} Z`;
}

function formatAxisValue(value: number): string {
  if (value >= 1_000_000) return `${formatRoundedAxisValue(value / 1_000_000)}M`;
  if (value >= 1_000) return `${formatRoundedAxisValue(value / 1_000)}K`;
  return formatRoundedAxisValue(value);
}

function formatRoundedAxisValue(value: number): string {
  return value >= 10 || Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1);
}

function formatShortDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, date)));
}

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
