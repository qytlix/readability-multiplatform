/** 清洗流水线状态 */
export type PipelineStatus =
  | 'pending'
  | 'fetching'
  | 'cleaning'
  | 'converting'
  | 'success'
  | 'failed';

/** Stable Reader block kinds supported by Translation. */
export type ContentSegmentType = 'p' | 'ul' | 'ol';

/**
 * A deterministic, sanitized Reader block. Consumers use this contract rather
 * than relying on the content cleaner's DOM implementation.
 */
export interface ContentSegment {
  id: string;
  orderIndex: number;
  type: ContentSegmentType;
  sourceHtml: string;
  sourceText: string;
}

/** 清洗结果（Renderer 和 AI 可安全消费的契约） */
export interface CleanedContent {
  entryId: number;
  sourceUrl: string;
  /** 原始 HTML（从目标网页 fetch 回来的未经清洗的 HTML） */
  html?: string;
  /** Readability 清洗后的纯净 HTML */
  cleanedHtml: string;
  markdown: string;
  readabilityTitle?: string;
  readabilityByline?: string;
  pipelineStatus: PipelineStatus;
  pipelineError?: string;
  segmenterVersion?: string;
  sourceContentHash?: string;
  segments?: ContentSegment[];
}

/** 正文提取结果 */
export interface FetchResult {
  url: string;                          // 最终 URL（重定向后）
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  charset?: string;
}

/** Readability 清洗结果 */
export interface CleanResult {
  title: string;
  byline?: string;
  content: string;                      // cleaned HTML
  documentBaseURL: string;
}
