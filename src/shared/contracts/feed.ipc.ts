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

// ── Channel Constants ─────────────────────────────────────

export const FEED_IPC_CHANNELS = {
  feedAdd: 'feed:add',
  feedList: 'feed:list',
  feedSync: 'feed:sync',
  feedRemove: 'feed:remove',
  feedUpdate: 'feed:update',
  feedSyncProgress: 'feed:sync-progress',
  contentFetch: 'content:fetch-and-clean',
  contentGet: 'content:get',
  entryList: 'entry:list',
  entryMarkRead: 'entry:mark-read',
  entryMarkStarred: 'entry:mark-starred',
} as const;
