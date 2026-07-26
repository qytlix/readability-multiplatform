import type {
  ArticleAvailability,
  PerArticleOptions,
} from './export.types';

// ── 清洗状态检查 ──

export interface CheckAvailabilityRequest {
  entryIds: number[];
}

export interface CheckAvailabilityResponse {
  articles: ArticleAvailability[];
  /** 未清洗完成的 entryId 列表 */
  unwashedIds: number[];
}

// ── 单篇清洗触发 ──

export interface CleanSingleRequest {
  entryId: number;
}

export interface CleanProgressEvent {
  entryId: number;
  status: 'cleaning' | 'success' | 'failed';
  error?: string;
}

// ── 单篇导出 ──

export interface ExportSingleRequest {
  entryId: number;
  options: PerArticleOptions;
}

export interface ExportSingleResult {
  filePath: string;
}

// ── 多篇导出（已确认选项后） ──

export interface ExportMultipleRequest {
  entries: Array<{
    entryId: number;
    options: PerArticleOptions;
  }>;
}

export interface ExportMultipleResult {
  filePath: string;
}

// ── 错误码 ──

export const EXPORT_ERROR_CODES = {
  EXPORT_ENTRY_NOT_FOUND: 'EXPORT_ENTRY_NOT_FOUND',
  EXPORT_CONTENT_NOT_FOUND: 'EXPORT_CONTENT_NOT_FOUND',
  EXPORT_WRITE_FAILED: 'EXPORT_WRITE_FAILED',
  EXPORT_SAVE_CANCELED: 'EXPORT_SAVE_CANCELED',
  EXPORT_TOO_MANY_ARTICLES: 'EXPORT_TOO_MANY_ARTICLES',
  EXPORT_CLEAN_FAILED: 'EXPORT_CLEAN_FAILED',
} as const;

// ── Channel 常量 ──

export const EXPORT_IPC_CHANNELS = {
  checkAvailability: 'export:check-availability',
  cleanSingle: 'export:clean-single',
  cleanSingleProgress: 'export:clean-single-progress',
  exportSingle: 'export:single',
  exportMultiple: 'export:multiple',
} as const;