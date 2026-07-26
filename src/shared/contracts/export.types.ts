import type { EntryAnnotation } from './annotation.types';
import type {
  TranslationSegment,
  TranslationSourceLanguage,
  TranslationTargetLanguage,
} from './translation.types';

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

/** 翻译语言对。导出时用于查找对应语言的翻译结果。 */
export interface TranslationLanguage {
  sourceLanguage: TranslationSourceLanguage;
  targetLanguage: TranslationTargetLanguage;
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
  /** 清洗后的 HTML（用于 interleaved 译文格式的 DOM 匹配） */
  cleanedHtml?: string;

  /** 可选 AI 内容（不存在时省略） */
  summary?: string;
  translation?: string;
  /** 逐段译文数据。存在时 MarkdownSerializer 使用 interleaved 格式代替旧块引用。 */
  translationSegments?: TranslationSegment[];

  /** 可选用户笔记（P1，预留 — 向后兼容的纯文本拼接） */
  notes?: string;

  /** 可选原始注释数据（用于脚注格式导出） */
  annotations?: EntryAnnotation[];

  /** 用户选择的选项（序列化时根据此决定输出哪些字段） */
  exportOptions?: PerArticleOptions;
}