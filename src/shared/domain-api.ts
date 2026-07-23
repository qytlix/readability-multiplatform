import type {
  EntryReadingProgress,
  EntryStats,
  Feed,
  EntryListItem,
} from './contracts/feed.types';
import type { CleanedContent } from './contracts/content.types';
import type {
  FeedSyncProgress,
  IPCResult,
  OPMLImportResult,
} from './contracts/feed.ipc';
import type { ExternalOpenRequest } from './contracts/external.ipc';

/**
 * Renderer-facing domain API interfaces.
 *
 * These types define the shape of each domain API that the Renderer
 * can call via Preload. They are consumed indirectly through the
 * aggregated {@link ShaleAPI} in `ipc.ts`.
 *
 * @module
 */

export interface FeedAPI {
  add: (url: string) => Promise<IPCResult<{ feed: Feed; entries: EntryListItem[] }>>;
  list: () => Promise<IPCResult<Feed[]>>;
  sync: (feedId?: number) => Promise<IPCResult<{
    feed: Feed;
    newCount: number;
    entries: EntryListItem[];
  }>>;
  remove: (feedId: number) => Promise<IPCResult<void>>;
  update: (
    feedId: number,
    params: Partial<Pick<Feed, 'title' | 'siteURL' | 'syncIntervalMin'>>,
  ) => Promise<IPCResult<Feed>>;
  syncCancel: () => Promise<IPCResult<void>>;
  onSyncProgress: (callback: (progress: FeedSyncProgress) => void) => () => void;
}

export interface OPMLAPI {
  import: (
    filePath: string,
    mode: 'merge' | 'replace',
  ) => Promise<IPCResult<OPMLImportResult>>;
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
  stats: () => Promise<IPCResult<EntryStats>>;
  updateReadingProgress: (
    entryId: number,
    readingProgress: number,
  ) => Promise<IPCResult<EntryReadingProgress>>;
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
