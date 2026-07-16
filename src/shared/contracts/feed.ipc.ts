import type { Feed, EntryListItem } from './feed.types';
import type { CleanedContent } from './content.types';

// ── Feed IPC ──────────────────────────────────────────────

export interface FeedAddRequest {
  url: string;
}

export interface FeedAddResponse {
  feed: Feed;
  entries: EntryListItem[];
}

export interface FeedSyncRequest {
  feedId?: number; // Omit for full sync
}

export interface FeedSyncProgress {
  feedId: number;
  feedTitle: string;
  status: 'pending' | 'fetching' | 'parsing' | 'saving' | 'done' | 'error';
  error?: string;
  newCount: number;
  timestamp: string;
}

export interface FeedSyncResponse {
  feed: Feed;
  newCount: number;
  entries: EntryListItem[];
}

export interface FeedRemoveRequest {
  feedId: number;
}

export interface FeedUpdateRequest {
  feedId: number;
  params: Partial<Pick<Feed, 'title' | 'siteURL' | 'syncIntervalMin'>>;
}

// ── Content IPC ───────────────────────────────────────────

export interface ContentFetchRequest {
  entryId: number;
}

export interface ContentGetRequest {
  entryId: number;
}

// ── Entry IPC ─────────────────────────────────────────────

export interface EntryListRequest {
  feedId?: number;
  isRead?: boolean;
  isStarred?: boolean;
  search?: string;
  limit: number;
  cursor?: { publishedAt: string; id: number };
}

export interface EntryListResponse {
  entries: EntryListItem[];
  nextCursor?: { publishedAt: string; id: number };
}

export interface EntryMarkReadRequest {
  ids: number[];
  isRead: boolean;
}

export interface EntryMarkStarredRequest {
  id: number;
  isStarred: boolean;
}

// ── Unified IPC Result ────────────────────────────────────

export interface ShaleError {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

export type IPCResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ShaleError };

// ── OPML IPC ───────────────────────────────────────────────

export interface OPMLImportRequest {
  filePath: string;
  mode: 'merge' | 'replace';
}

export interface OPMLImportResult {
  successCount: number;
  skipCount: number;
  failures: Array<{ title?: string; xmlUrl?: string; error: string }>;
  totalFound: number;
}

export interface OPMLExportRequest {
  filePath: string;
}

// ── Sync Cancel ───────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface SyncCancelRequest {
  // empty — cancels the current sync operation
}

// ── File Dialog IPC ───────────────────────────────────────

export interface FileOpenDialogOptions {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  defaultPath?: string;
}

export interface FileSaveDialogOptions {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  defaultPath?: string;
}

export interface FileOpenResult {
  canceled: boolean;
  filePaths: string[];
}

// ── Channel Constants ─────────────────────────────────────

export const FEED_IPC_CHANNELS = {
  feedAdd: 'feed:add',
  feedList: 'feed:list',
  feedSync: 'feed:sync',
  feedRemove: 'feed:remove',
  feedUpdate: 'feed:update',
  feedSyncCancel: 'feed:sync-cancel',
  feedSyncProgress: 'feed:sync-progress',
  opmlImport: 'opml:import',
  opmlExport: 'opml:export',
  dialogOpenFile: 'dialog:open-file',
  dialogSaveFile: 'dialog:save-file',
  contentFetch: 'content:fetch-and-clean',
  contentGet: 'content:get',
  entryList: 'entry:list',
  entryMarkRead: 'entry:mark-read',
  entryMarkStarred: 'entry:mark-starred',
} as const;
