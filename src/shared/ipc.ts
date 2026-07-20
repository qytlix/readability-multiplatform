import type { ProviderAPI, SummaryAPI } from './contracts/summary.ipc';
import type { TranslationAPI } from './contracts/translation.ipc';
import type {
  FeedAPI,
  EntryAPI,
  ContentAPI,
  OPMLAPI,
  ExternalAPI,
} from './domain-api';

export const IPC_CHANNELS = {
  systemPing: 'system:ping',
} as const;

export type PingResponse = {
  ok: true;
  message: 'pong';
};

// Domain API interfaces are re-exported from domain-api.ts for convenience.
export type { FeedAPI, OPMLAPI, EntryAPI, ContentAPI, ExternalAPI };

export interface ShaleAPI {
  system: {
    ping: () => Promise<PingResponse>;
  };
  feed: FeedAPI;
  entry: EntryAPI;
  content: ContentAPI;
  opml: OPMLAPI;
  dialog: {
    openFile: (options?: {
      title?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
      defaultPath?: string;
    }) => Promise<{ canceled: boolean; filePaths: string[] }>;
    saveFile: (options?: {
      title?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
      defaultPath?: string;
    }) => Promise<{ canceled: boolean; filePath: string }>;
  };
  external: ExternalAPI;
  provider: ProviderAPI;
  summary: SummaryAPI;
  translation: TranslationAPI;
}
