import type { EntryAnnotation } from './annotation.types';

/** 用户为单篇文章选择的导出选项 */
export interface PerArticleOptions {
  includeSummary: boolean;
  includeTranslation: boolean;
  includeNotes: boolean;
}

/** 默认值：全部包含 */
export const DEFAULT_PER_ARTICLE_OPTIONS: PerArticleOptions = {
  includeSummary: true,
  includeTranslation: true,
  includeNotes: true,
};

/** 单篇文章的可用数据状态（供选项对话框渲染使用） */
export interface ArticleAvailability {
  entryId: number;
  title: string;
  pipelineStatus:
    | 'success'
    | 'pending'
    | 'fetching'
    | 'cleaning'
    | 'converting'
    | 'failed';
  hasSummary: boolean;
  hasTranslation: boolean;
  hasNotes: boolean;
}

/** 单篇文章的导出数据聚合 */
export interface ExportableArticle {
  entryId: number;

  /** 元信息 */
  feedTitle?: string;
  url?: string;
  title?: string;
  author?: string;
  publishedAt?: string; // ISO-8601

  /** 正文 */
  cleanedMarkdown: string;

  /** 可选 AI 内容（不存在时省略） */
  summary?: string;
  translation?: string;

  /** 可选用户笔记（P1，预留 — 向后兼容的纯文本拼接） */
  notes?: string;

  /** 可选原始注释数据（用于脚注格式导出） */
  annotations?: EntryAnnotation[];

  /** 用户选择的选项（序列化时根据此决定输出哪些字段） */
  exportOptions?: PerArticleOptions;
}