import type { IPCResult } from './feed.ipc';
import type {
  ProviderConnectionTestResult,
  ProviderProfile,
  SaveProviderRequest,
} from './provider.types';
import type {
  SummaryGenerateRequest,
  SummaryGenerateResponse,
  SummaryGetRequest,
  SummaryState,
  SummaryStreamEvent,
} from './summary.types';

export const SUMMARY_IPC_CHANNELS = {
  providerGet: 'provider:get',
  providerSave: 'provider:save',
  providerTest: 'provider:test',
  summaryGet: 'summary:get',
  summaryGenerate: 'summary:generate',
  summaryStream: 'summary:stream',
} as const;

export interface ProviderAPI {
  get: () => Promise<IPCResult<ProviderProfile | null>>;
  save: (request: SaveProviderRequest) => Promise<IPCResult<ProviderProfile>>;
  test: () => Promise<IPCResult<ProviderConnectionTestResult>>;
}

export interface SummaryAPI {
  get: (request: SummaryGetRequest) => Promise<IPCResult<SummaryState>>;
  generate: (
    request: SummaryGenerateRequest,
  ) => Promise<IPCResult<SummaryGenerateResponse>>;
  onEvent: (listener: (event: SummaryStreamEvent) => void) => () => void;
}
