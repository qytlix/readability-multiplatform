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
  summary?: string;
  isRead: boolean;
  isStarred: boolean;
  isDeleted: boolean;                   // tombstone 标记
  contentHash?: string;
  createdAt: string;
  updatedAt: string;
}

/** 文章列表轻量投影 */
import type { PipelineStatus } from './content.types';

export interface EntryListItem {
  id: number;
  feedId: number;
  feedTitle?: string;
  title?: string;
  author?: string;
  publishedAt?: string;
  createdAt: string;
  isRead: boolean;
  isStarred: boolean;
  summary?: string;
  pipelineStatus: PipelineStatus;
}

/** Entry 查询参数 */
export interface EntryQuery {
  feedId?: number;
  isRead?: boolean;
  isStarred?: boolean;
  search?: string;
  limit: number;                        // 默认 50
  cursor?: {
    publishedAt: string;
    id: number;
  };
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
  summary?: string;
  contentHtml?: string;                 // Feed 内嵌 HTML
}