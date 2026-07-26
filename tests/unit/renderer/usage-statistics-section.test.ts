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

    expect(container?.textContent).toContain('Loading usage statistics…');
  });

  it('loads the default 30-day system-time-zone query and presents reported coverage', async () => {
    const getStatistics = vi.fn().mockResolvedValue({ ok: true, data: createStatistics() });
    installUsageApi(getStatistics);

    await renderSection();

    expect(getStatistics).toHaveBeenCalledTimes(1);
    const query = getStatistics.mock.calls[0]?.[0];
    expect(query.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(Date.parse(query.endAt) - Date.parse(query.startAt)).toBe(30 * 24 * 60 * 60 * 1000);
    expect(container?.textContent).toContain('Provider-reported total tokens');
    expect(container?.textContent).toContain('12');
    expect(container?.textContent).toContain('Not reported');
    expect(container?.textContent).toContain('3');
    expect(container?.textContent).toContain('Provider #7 · model-alpha');
    expect(container?.textContent).toContain('These totals are not a complete estimate.');
    expect(container?.textContent).toContain('historical request cannot be assigned to an execution.');
  });

  it('reloads for the selected 7-day range', async () => {
    const getStatistics = vi.fn().mockResolvedValue({ ok: true, data: createStatistics() });
    installUsageApi(getStatistics);
    await renderSection();

    const rangeButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent === '7 days');
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
      .find((button) => button.textContent === 'Reported Tokens');
    const requestsButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent === 'Requests');
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
    expect(container?.textContent).toContain('No Provider requests were recorded.');
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

    expect(container?.textContent).toContain('Provider-reported total tokens: 12 (reported by 2 of 3 requests)');
    expect(container?.textContent).toContain('Input tokens: 7 (reported by 2 of 3 requests)');
    expect(container?.textContent).toContain('Output tokens: Not reported');
    expect(container?.textContent).toContain('Token coverage: Partial (2 of 3 requests reported total tokens)');
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

    expect(container?.textContent).toContain('Provider-reported total tokens: Not reported');
    expect(container?.textContent).toContain('Token coverage: Not reported (0 of 3 requests reported total tokens)');
  });

  it('shows an explicit empty state when no Provider requests were recorded', async () => {
    const getStatistics = vi.fn().mockResolvedValue({
      ok: true,
      data: createStatistics({ requestCount: 0 }),
    });
    installUsageApi(getStatistics);

    await renderSection();

    expect(container?.textContent).toContain('No Provider requests were recorded for the selected period.');
    expect(container?.textContent).not.toContain('Usage Trends');
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

    expect(container?.textContent).toContain('Unable to load usage statistics. Try again.');
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
