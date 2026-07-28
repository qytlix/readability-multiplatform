/** Feed 订阅源 */
export interface Feed {
  id: number;
  title?: string;
  feedURL: string;
  siteURL?: string;
  feedParserVersion?: number;
  lastFetchedAt?: string;               // ISO-8601 datetime
  lastSyncStatus: SyncStatus;
  lastSyncError?: string;
  lastETag?: string;
  lastModified?: string;
  syncIntervalMin: number;              // 定时同步间隔（分钟）
  createdAt: string;                    // ISO-8601 datetime
}

export type SyncStatus = 'never' | 'success' | 'error';

/** Entry 文章条目 */
export interface Entry {
  id: number;
  feedId: number;
  guid?: string;
  url?: string;
  title?: string;
  author?: string;
  publishedAt?: string;                 // ISO-8601 datetime
  summary?: string;                     // 纯文本；不得包含 Feed HTML 标记
  isRead: boolean;
  readingProgress: number;
  isStarred: boolean;
  isDeleted: boolean;                   // tombstone 标记
  contentHash?: string;
  createdAt: string;
  updatedAt: string;
}

/** 文章列表轻量投影 */
import type { PipelineStatus } from './content.types';
import type { Tag } from './tag.types';

export interface EntryListItem {
  id: number;
  feedId: number;
  feedTitle?: string;
  url?: string;
  title?: string;
  author?: string;
  publishedAt?: string;
  createdAt: string;
  isRead: boolean;
  readingProgress: number;
  isStarred: boolean;
  summary?: string;                     // 纯文本；不得包含 Feed HTML 标记
  pipelineStatus: PipelineStatus;
  tags?: Tag[];                         // Phase 3: tag pills + filtering
  /** Plain-text excerpt around the first body match. Renderer owns highlighting. */
  searchSnippet?: string;
}

export interface EntryCursor {
  /** Effective publication time: publishedAt with createdAt as the fallback. */
  publishedAt: string;
  id: number;
  /** Present only for ranked search pagination. Higher tiers sort first. */
  matchTier?: number;
  /** FTS5 BM25 rank. Lower values are more relevant. */
  rank?: number;
}

// ── Search Filter Types ──────────────────────────────────

export type FilterField =
  | 'tag' | 'feed' | 'title' | 'content' | 'author'
  | 'starred' | 'read';

export type FilterOperator = '+' | '-' | '';

export interface SearchFilter {
  field: FilterField;
  operator: FilterOperator;
  value: string;
  /**
   * Match mode for tag field.
   * - `'fuzzy'` or omitted → LIKE with %% (default, for `tag:` syntax)
   * - `'exact'` → equality (for `tag=` syntax)
   * Ignored for non-tag fields.
   */
  match?: 'fuzzy' | 'exact';
}

/** Entry 查询参数 */
export interface EntryQuery {
  feedId?: number;
  isRead?: boolean;
  isStarred?: boolean;
  search?: string;
  filters?: SearchFilter[];
  limit: number;                        // 默认 50
  cursor?: EntryCursor;
}

/** Feed 解析器统一输出 */
export interface ParsedFeed {
  title?: string;
  siteUrl?: string;
  feedUrl: string;
  entries: ParsedEntry[];
}

export interface ParsedEntry {
  guid: string;
  url?: string;
  title?: string;
  author?: string;
  publishedAt?: string;                 // ISO-8601
  summary?: string;                     // 纯文本；不得包含 Feed HTML 标记
  contentHtml?: string;                 // Feed 内嵌 HTML
}

export interface EntryReadStats {
  total: number;
  unread: number;
  readPercentage: number;
}

export interface FeedEntryReadStats extends EntryReadStats {
  feedId: number;
}

export interface EntryStats {
  all: EntryReadStats;
  feeds: FeedEntryReadStats[];
  tagCount: number;
}

export interface EntryReadingProgress {
  entryId: number;
  readingProgress: number;
  isRead: boolean;
  becameRead: boolean;
}
