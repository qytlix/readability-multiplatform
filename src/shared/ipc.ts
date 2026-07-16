import type { Feed, EntryListItem } from './contracts/feed.types';
import type { CleanedContent } from './contracts/content.types';
import type { IPCResult, ShaleError, FeedSyncProgress, OPMLImportResult } from './contracts/feed.ipc';
import type { ExternalOpenRequest } from './contracts/external.ipc';

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
  update: (feedId: number, params: Partial<Pick<Feed, 'title' | 'siteURL' | 'syncIntervalMin'>>) => Promise<IPCResult<Feed>>;
  syncCancel: () => Promise<IPCResult<void>>;
  onSyncProgress: (callback: (progress: FeedSyncProgress) => void) => () => void;
}

export interface OPMLAPI {
  import: (filePath: string, mode: 'merge' | 'replace') => Promise<IPCResult<OPMLImportResult>>;
  export: (filePath: string) => Promise<IPCResult<void>>;
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
  opml: OPMLAPI;
  dialog: {
    openFile: (options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }>; defaultPath?: string }) => Promise<{ canceled: boolean; filePaths: string[] }>;
    saveFile: (options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }>; defaultPath?: string }) => Promise<{ canceled: boolean; filePath: string }>;
  };
  external: ExternalAPI;
}
