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
const numberFormatter = new Intl.NumberFormat('zh-CN');

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
      <h3 id="usage-statistics-title" className="settings-section-title">模型用量统计</h3>
      <div className="settings-card usage-statistics-card">
        <div className="usage-statistics-header">
          <p>
            用于摘要和全文翻译的服务商实报 Token 用量。
            按日统计使用 {statistics?.query.timeZone ?? timeZone}。
          </p>
          <div className="usage-range-selector" aria-label="模型用量统计日期范围">
            {RANGE_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                className={rangeDays === days ? 'is-selected' : ''}
                aria-pressed={rangeDays === days}
                onClick={() => setRangeDays(days)}
              >
                {days} 天
              </button>
            ))}
          </div>
        </div>

        {loadState === 'loading' && (
          <p className="usage-statistics-state" role="status">正在加载模型用量统计…</p>
        )}

        {loadState === 'error' && (
          <div className="usage-statistics-error" role="alert">
            <p>无法加载模型用量统计，请重试。</p>
            <button type="button" onClick={retry}>重试</button>
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
        所选时间范围内没有记录服务商请求。
      </p>
    );
  }

  const hasIncompleteUsage = totals.tokenCoverage.partialRequests > 0
    || totals.tokenCoverage.missingRequests > 0;
  const hasUnassignedRequests = totals.attemptCoverage.unassignedRequestCount > 0;

  return (
    <div className="usage-statistics-content">
      <div className="usage-statistics-summary" aria-label="模型用量汇总">
        <UsageTokenMetric aggregate={totals} field="totalTokens" label="服务商实报总 Token" />
        <UsageTokenMetric aggregate={totals} field="inputTokens" label="输入 Token" />
        <UsageTokenMetric aggregate={totals} field="outputTokens" label="输出 Token" />
        <UsageMetric
          label="服务商请求"
          value={formatNumber(totals.requestCount)}
          detail="每条记录对应一次实际的服务商请求。"
        />
        <UsageMetric
          label="已知执行次数"
          value={formatNumber(totals.attemptCoverage.knownAttemptCount)}
          detail={hasUnassignedRequests
            ? `${formatNumber(totals.attemptCoverage.unassignedRequestCount)} 条历史请求没有执行标识。`
            : '不同的摘要或全文翻译执行次数。'}
        />
      </div>

      {(hasIncompleteUsage || hasUnassignedRequests) && (
        <p className="usage-statistics-coverage-note" role="status">
          这些总计并非完整估算，只累计服务商明确报告的 Token 字段，缺失字段不会按 0 处理。
          {hasIncompleteUsage && ` ${formatNumber(
            totals.tokenCoverage.partialRequests + totals.tokenCoverage.missingRequests,
          )} 条请求报告了部分用量或未报告用量。`}
          {hasUnassignedRequests && ` ${formatNumber(
            totals.attemptCoverage.unassignedRequestCount,
          )} 条历史请求无法归属到某次执行。`}
        </p>
      )}

      <UsageTrendsCard statistics={statistics} />

      <div className="usage-statistics-breakdowns">
        <UsageBreakdownTable
          title="按日期"
          firstColumn="日期"
          rows={statistics.byDay.map((item) => ({
            key: item.day,
            label: item.day,
            aggregate: item,
          }))}
        />
        <UsageBreakdownTable
          title="按功能"
          firstColumn="功能"
          rows={statistics.byTaskType.map((item) => ({
            key: item.taskType,
            label: item.taskType === 'summary' ? '摘要' : '全文翻译',
            aggregate: item,
          }))}
        />
        <UsageBreakdownTable
          title="按服务商和模型"
          firstColumn="服务商 + 模型"
          rows={statistics.byModel.map((item) => ({
            key: `${String(item.providerProfileId)}\u0000${item.model}`,
            label: `服务商 #${String(item.providerProfileId)} · ${item.model}`,
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
          <h4 id="usage-trends-title">用量趋势</h4>
          <p>按日统计使用 {statistics.query.timeZone}。</p>
        </div>
        <div className="usage-trend-view-selector" aria-label="用量趋势指标">
          <button
            type="button"
            className={view === 'tokens' ? 'is-selected' : ''}
            aria-pressed={view === 'tokens'}
            onClick={() => selectView('tokens')}
          >
            实报 Token
          </button>
          <button
            type="button"
            className={view === 'requests' ? 'is-selected' : ''}
            aria-pressed={view === 'requests'}
            onClick={() => selectView('requests')}
          >
            请求数
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
        aria-label={`按日期的${view === 'tokens' ? '服务商实报总 Token' : '服务商请求数'}趋势`}
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
                />
              )}
              {view === 'tokens' && coverage === 'not-reported' && (
                <path
                  className="usage-trend-unreported-marker"
                  d={`M ${x - 3} ${plotBottom - 6} L ${x + 3} ${plotBottom} M ${x + 3} ${plotBottom - 6} L ${x - 3} ${plotBottom}`}
                />
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
          柱状图显示实报总 Token；深绿色柱表示总 Token 覆盖不完整，交叉标记表示已有请求但未报告总 Token，
          空白日期没有服务商请求。
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
        <span>请求数：{formatNumber(aggregate?.requestCount ?? 0)}</span>
      ) : aggregate ? (
        <>
          <span>服务商实报总 Token：{formatTrendTokenValue(aggregate, 'totalTokens')}</span>
          <span>输入 Token：{formatTrendTokenValue(aggregate, 'inputTokens')}</span>
          <span>输出 Token：{formatTrendTokenValue(aggregate, 'outputTokens')}</span>
          <span>Token 覆盖状态：{formatTokenCoverage(aggregate)}</span>
        </>
      ) : (
        <span>没有记录服务商请求。</span>
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
    ? '未报告'
    : formatNumber(aggregate.tokenTotals[field]);
  const detail = reportedRequests === 0
    ? '没有请求报告此 Token 字段。'
    : `${formatNumber(aggregate.requestCount)} 条请求中有 ${formatNumber(reportedRequests)} 条报告了此字段。`;

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
        <colgroup>
          <col />
          <col className="usage-statistics-table-numeric-column" />
          <col className="usage-statistics-table-numeric-column" />
          <col className="usage-statistics-table-numeric-column" />
          <col className="usage-statistics-table-numeric-column" />
          <col className="usage-statistics-table-numeric-column" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{firstColumn}</th>
            <th scope="col">输入</th>
            <th scope="col">输出</th>
            <th scope="col">总计</th>
            <th scope="col">请求</th>
            <th scope="col">执行</th>
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
  return <td>{isReported ? formatNumber(aggregate.tokenTotals[field]) : '—'}</td>;
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
  if (reportedRequests === 0) return '未报告';
  return `${formatNumber(aggregate.tokenTotals[field])}（${formatNumber(aggregate.requestCount)} 条请求中有 ${formatNumber(reportedRequests)} 条实报）`;
}

function formatTokenCoverage(aggregate: UsageAggregate): string {
  const reportedRequests = aggregate.tokenCoverage.totalTokens;
  const coverage = getTokenCoverageState(aggregate);
  if (coverage === 'complete') {
    return `完整（${formatNumber(aggregate.requestCount)} 条请求中有 ${formatNumber(reportedRequests)} 条报告总 Token）`;
  }
  if (coverage === 'partial') {
    return `部分（${formatNumber(aggregate.requestCount)} 条请求中有 ${formatNumber(reportedRequests)} 条报告总 Token）`;
  }
  return `未报告（${formatNumber(aggregate.requestCount)} 条请求中有 0 条报告总 Token）`;
}

function createPointAriaLabel(point: UsageTrendPoint, view: UsageTrendView): string {
  const aggregate = point.aggregate;
  if (!aggregate) return `${point.day}：没有服务商请求`;
  if (view === 'requests') return `${point.day}：${formatNumber(aggregate.requestCount)} 个请求`;
  return `${point.day}：${formatTrendTokenValue(aggregate, 'totalTokens')}；${formatTokenCoverage(aggregate)}`;
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
  if (value >= 10_000) return `${formatRoundedAxisValue(value / 10_000)}万`;
  return formatRoundedAxisValue(value);
}

function formatRoundedAxisValue(value: number): string {
  return value >= 10 || Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1);
}

function formatShortDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('zh-CN', {
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
