import type { IPCResult } from './feed.ipc';
import type {
  ProviderChatModelList,
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
  providerTestChat: 'provider:test-chat',
  providerTestChatImage: 'provider:test-chat-image',
  providerListChatModels: 'provider:list-chat-models',
  summaryGet: 'summary:get',
  summaryGenerate: 'summary:generate',
  summaryStream: 'summary:stream',
} as const;

export interface ProviderAPI {
  get: () => Promise<IPCResult<ProviderProfile | null>>;
  save: (request: SaveProviderRequest) => Promise<IPCResult<ProviderProfile>>;
  test: () => Promise<IPCResult<ProviderConnectionTestResult>>;
  testChat: () => Promise<IPCResult<ProviderConnectionTestResult>>;
  testChatImage: () => Promise<IPCResult<ProviderConnectionTestResult>>;
  listChatModels: () => Promise<IPCResult<ProviderChatModelList>>;
}

export interface SummaryAPI {
  get: (request: SummaryGetRequest) => Promise<IPCResult<SummaryState>>;
  generate: (
    request: SummaryGenerateRequest,
  ) => Promise<IPCResult<SummaryGenerateResponse>>;
  onEvent: (listener: (event: SummaryStreamEvent) => void) => () => void;
}
