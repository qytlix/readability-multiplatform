// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UsageStatistics } from '../../../src/shared/contracts/usage.types';
import { UsageStatisticsSection } from '../../../src/renderer/features/settings/UsageStatisticsSection';

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe('UsageStatisticsSection', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
  });

  it('shows loading while the read-only query is pending', async () => {
    const getStatistics = vi.fn(() => new Promise(() => undefined));
    installUsageApi(getStatistics);

    await renderSection();

    expect(container?.textContent).toContain('正在加载模型用量统计…');
  });

  it('loads the default 30-day system-time-zone query and presents reported coverage', async () => {
    const getStatistics = vi.fn().mockResolvedValue({ ok: true, data: createStatistics() });
    installUsageApi(getStatistics);

    await renderSection();

    expect(getStatistics).toHaveBeenCalledTimes(1);
    const query = getStatistics.mock.calls[0]?.[0];
    expect(query.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(Date.parse(query.endAt) - Date.parse(query.startAt)).toBe(30 * 24 * 60 * 60 * 1000);
    expect(container?.textContent).toContain('服务商实报总 Token');
    expect(container?.textContent).toContain('12');
    expect(container?.textContent).toContain('未报告');
    expect(container?.textContent).toContain('3');
    expect(container?.textContent).toContain('服务商 #7 · model-alpha');
    expect(container?.querySelector('.usage-statistics-coverage-note')?.textContent?.trim())
      .toBe('这些总计并非完整估算，只累计了服务商明确报告的 Token 字段');
    expect(container?.textContent).not.toContain('每条记录对应一次实际的服务商请求');
    expect(container?.textContent).not.toContain('不同的摘要或全文翻译执行次数');
    expect(container?.textContent).not.toContain('条历史请求没有执行标识');
    expect(container?.textContent).not.toContain('用于摘要和全文翻译的服务商实报 Token 用量');
    expect(container?.textContent).not.toContain('条请求中有 2 条报告了此字段');
    expect(container?.textContent).not.toContain('按日统计使用 Asia/Shanghai');
    expect(container?.textContent).not.toContain('柱状图显示实报总 Token');
    expect(container?.querySelectorAll('.usage-statistics-table-numeric-column')).toHaveLength(15);
    expect(container?.querySelector('.usage-statistics-table-wrap td[title]')).toBeNull();
  });

  it('reloads for the selected 7-day range', async () => {
    const getStatistics = vi.fn().mockResolvedValue({ ok: true, data: createStatistics() });
    installUsageApi(getStatistics);
    await renderSection();

    const rangeButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent === '7 天');
    expect(rangeButton).toBeDefined();
    await act(async () => {
      rangeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getStatistics).toHaveBeenCalledTimes(2);
    const query = getStatistics.mock.calls[1]?.[0];
    expect(Date.parse(query.endAt) - Date.parse(query.startAt)).toBe(7 * 24 * 60 * 60 * 1000);
    expect(rangeButton?.getAttribute('aria-pressed')).toBe('true');
  });

  it('switches the trends card between reported-token bars and request area trend without another query', async () => {
    const getStatistics = vi.fn().mockResolvedValue({ ok: true, data: createStatistics() });
    installUsageApi(getStatistics);
    await renderSection();

    const reportedTokensButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent === '实报 Token');
    const requestsButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent === '请求数');
    expect(reportedTokensButton?.getAttribute('aria-pressed')).toBe('true');
    expect(container?.querySelector('.usage-trend-bar')).not.toBeNull();

    await act(async () => {
      requestsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(getStatistics).toHaveBeenCalledTimes(1);
    expect(requestsButton?.getAttribute('aria-pressed')).toBe('true');
    expect(container?.querySelector('.usage-trend-area')).not.toBeNull();
    expect(container?.querySelector('.usage-trend-line')).not.toBeNull();
    expect(container?.querySelector('.usage-trend-line-point')).toBeNull();
  });

  it('fills missing dates as no requests instead of a zero-token report', async () => {
    const statistics = createStatistics();
    const sourceDay = statistics.byDay[0];
    if (!sourceDay) throw new Error('Expected default usage statistics to contain a day');
    statistics.byDay = [
      sourceDay,
      { ...sourceDay, day: '2026-07-26' },
    ];
    const getStatistics = vi.fn().mockResolvedValue({ ok: true, data: statistics });
    installUsageApi(getStatistics);
    await renderSection();

    const missingDate = container?.querySelector<SVGRectElement>('[data-day="2026-07-25"]');
    const partialDate = container?.querySelector<SVGRectElement>('[data-day="2026-07-24"]');
    expect(missingDate?.getAttribute('data-coverage')).toBe('no-requests');
    expect(partialDate?.getAttribute('data-coverage')).toBe('partial');

    await act(async () => {
      missingDate?.focus();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain('2026-07-25');
    expect(container?.textContent).toContain('没有记录服务商请求。');
  });

  it('shows exact available token fields and partial coverage in the token tooltip', async () => {
    const getStatistics = vi.fn().mockResolvedValue({ ok: true, data: createStatistics() });
    installUsageApi(getStatistics);
    await renderSection();

    const reportedDate = container?.querySelector<SVGRectElement>('[data-day="2026-07-24"]');
    await act(async () => {
      reportedDate?.focus();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain('服务商实报总 Token：12（3 条请求中有 2 条实报）');
    expect(container?.textContent).toContain('输入 Token：7（3 条请求中有 2 条实报）');
    expect(container?.textContent).toContain('输出 Token：未报告');
    expect(container?.textContent).toContain('Token 覆盖状态：部分（3 条请求中有 2 条报告总 Token）');
  });

  it('marks requests with no reported total tokens differently from dates without requests', async () => {
    const statistics = createStatistics();
    const sourceDay = statistics.byDay[0];
    if (!sourceDay) throw new Error('Expected default usage statistics to contain a day');
    statistics.byDay = [{
      ...sourceDay,
      tokenTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      tokenCoverage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        reportedRequests: 0,
        partialRequests: 0,
        missingRequests: sourceDay.requestCount,
      },
    }];
    const getStatistics = vi.fn().mockResolvedValue({ ok: true, data: statistics });
    installUsageApi(getStatistics);
    await renderSection();

    const unreportedDate = container?.querySelector<SVGRectElement>('[data-day="2026-07-24"]');
    expect(unreportedDate?.getAttribute('data-coverage')).toBe('not-reported');
    expect(container?.querySelector('.usage-trend-unreported-marker')).not.toBeNull();

    await act(async () => {
      unreportedDate?.focus();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain('服务商实报总 Token：未报告');
    expect(container?.textContent).toContain('Token 覆盖状态：未报告（3 条请求中有 0 条报告总 Token）');
  });

  it('shows an explicit empty state when no Provider requests were recorded', async () => {
    const getStatistics = vi.fn().mockResolvedValue({
      ok: true,
      data: createStatistics({ requestCount: 0 }),
    });
    installUsageApi(getStatistics);

    await renderSection();

    expect(container?.textContent).toContain('所选时间范围内没有记录服务商请求。');
    expect(container?.textContent).not.toContain('用量趋势');
    expect(container?.querySelector('table')).toBeNull();
  });

  it('uses a stable error message when the read-only query fails', async () => {
    const getStatistics = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: 'USAGE_QUERY_FAILED',
        message: 'database implementation detail',
        retryable: true,
      },
    });
    installUsageApi(getStatistics);

    await renderSection();

    expect(container?.textContent).toContain('无法加载模型用量统计，请重试。');
    expect(container?.textContent).not.toContain('database implementation detail');
  });

  async function renderSection(): Promise<void> {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(UsageStatisticsSection));
      await Promise.resolve();
      await Promise.resolve();
    });
  }
});

function installUsageApi(getStatistics: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal('shaleAPI', {
    usage: { getStatistics },
  } as unknown as typeof window.shaleAPI);
}

function createStatistics({ requestCount = 3 }: { requestCount?: number } = {}): UsageStatistics {
  const aggregate = {
    requestCount,
    requestStatus: {
      running: 0,
      succeeded: requestCount,
      failed: 0,
      interrupted: 0,
    },
    tokenTotals: {
      inputTokens: requestCount === 0 ? 0 : 7,
      outputTokens: 0,
      totalTokens: requestCount === 0 ? 0 : 12,
    },
    tokenCoverage: {
      inputTokens: requestCount === 0 ? 0 : 2,
      outputTokens: 0,
      totalTokens: requestCount === 0 ? 0 : 2,
      reportedRequests: 0,
      partialRequests: requestCount === 0 ? 0 : 2,
      missingRequests: requestCount === 0 ? 0 : 1,
    },
    attemptCoverage: {
      knownAttemptCount: requestCount === 0 ? 0 : 2,
      unassignedRequestCount: requestCount === 0 ? 0 : 1,
    },
  };
  return {
    query: {
      startAt: '2026-07-01T00:00:00.000Z',
      endAt: '2026-07-31T00:00:00.000Z',
      timeZone: 'Asia/Shanghai',
    },
    totals: aggregate,
    byDay: requestCount === 0 ? [] : [{ day: '2026-07-24', ...aggregate }],
    byTaskType: requestCount === 0 ? [] : [{ taskType: 'translation', ...aggregate }],
    byModel: requestCount === 0 ? [] : [{
      providerProfileId: 7,
      model: 'model-alpha',
      ...aggregate,
    }],
  };
}
