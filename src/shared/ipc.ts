import type { Feed, EntryListItem } from './contracts/feed.types';
import type { CleanedContent } from './contracts/content.types';
import type { IPCResult } from './contracts/feed.ipc';
import type { ExternalOpenRequest } from './contracts/external.ipc';
import type { ProviderAPI, SummaryAPI } from './contracts/summary.ipc';
import type { TranslationAPI } from './contracts/translation.ipc';

export const IPC_CHANNELS = {
  systemPing: 'system:ping',
} as const;

export type PingResponse = {
  ok: true;
  message: 'pong';
};

export interface FeedAPI {
  add: (url: string) => Promise<IPCResult<{ feed: Feed; entries: EntryListItem[] }>>;
  list: () => Promise<IPCResult<Feed[]>>;
  sync: (feedId?: number) => Promise<IPCResult<{
    feed: Feed;
    newCount: number;
    entries: EntryListItem[];
  }>>;
  remove: (feedId: number) => Promise<IPCResult<void>>;
}

export interface EntryAPI {
  list: (params: {
    feedId?: number;
    isRead?: boolean;
    isStarred?: boolean;
    search?: string;
    limit: number;
    cursor?: { publishedAt: string; id: number };
  }) => Promise<IPCResult<{
    entries: EntryListItem[];
    nextCursor?: { publishedAt: string; id: number };
  }>>;
  markRead: (ids: number[], isRead: boolean) => Promise<IPCResult<void>>;
  markStarred: (id: number, isStarred: boolean) => Promise<IPCResult<void>>;
}

export interface ContentAPI {
  fetchAndClean: (entryId: number) => Promise<IPCResult<CleanedContent>>;
  get: (entryId: number) => Promise<IPCResult<CleanedContent | null>>;
}

export interface ExternalAPI {
  open: (request: ExternalOpenRequest) => Promise<IPCResult<void>>;
}

export interface ShaleAPI {
  system: {
    ping: () => Promise<PingResponse>;
  };
  feed: FeedAPI;
  entry: EntryAPI;
  content: ContentAPI;
  external: ExternalAPI;
  provider: ProviderAPI;
  summary: SummaryAPI;
  translation: TranslationAPI;
}
