import type { IPCResult } from './feed.ipc';
import type { UsageStatistics, UsageStatisticsQuery } from './usage.types';

export const USAGE_IPC_CHANNELS = {
  statisticsGet: 'usage:get-statistics',
} as const;

export interface UsageAPI {
  getStatistics: (query: UsageStatisticsQuery) => Promise<IPCResult<UsageStatistics>>;
}
