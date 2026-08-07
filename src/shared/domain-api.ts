import type {
  EntryCursor,
  EntryReadingProgress,
  EntryStats,
  Feed,
  EntryListItem,
  SearchFilter,
} from './contracts/feed.types';
import type { CleanedContent } from './contracts/content.types';
import type {
  FeedSyncProgress,
  IPCResult,
  OPMLImportResult,
} from './contracts/feed.ipc';
import type { ExternalOpenRequest } from './contracts/external.ipc';
import type {
  CleanProgressEvent,
  ExportMultipleResult,
  ExportSingleResult,
} from './contracts/export.ipc';
import type {
  ArticleAvailability,
  PerArticleOptions,
} from './contracts/export.types';

export interface ExportAPI {
  checkAvailability: (
    entryIds: number[],
  ) => Promise<IPCResult<{
    articles: ArticleAvailability[];
    unwashedIds: number[];
  }>>;
  cleanSingle: (
    entryId: number,
    onProgress?: (event: CleanProgressEvent) => void,
  ) => Promise<IPCResult<void>>;
  single: (
    entryId: number,
    options: PerArticleOptions,
  ) => Promise<IPCResult<ExportSingleResult>>;
  multiple: (
    entries: Array<{ entryId: number; options: PerArticleOptions }>,
  ) => Promise<IPCResult<ExportMultipleResult>>;
}

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
    filters?: SearchFilter[];
    limit: number;
    cursor?: EntryCursor;
  }) => Promise<IPCResult<{
    entries: EntryListItem[];
    nextCursor?: EntryCursor;
  }>>;
  stats: () => Promise<IPCResult<EntryStats>>;
  updateReadingProgress: (
    entryId: number,
    readingProgress: number,
  ) => Promise<IPCResult<EntryReadingProgress>>;
  markRead: (ids: number[], isRead: boolean) => Promise<IPCResult<void>>;
  markStarred: (ids: number[], isStarred: boolean) => Promise<IPCResult<void>>;
}

export interface ContentAPI {
  fetchAndClean: (entryId: number) => Promise<IPCResult<CleanedContent>>;
  get: (entryId: number) => Promise<IPCResult<CleanedContent | null>>;
}

export interface ExternalAPI {
  open: (request: ExternalOpenRequest) => Promise<IPCResult<void>>;
}
