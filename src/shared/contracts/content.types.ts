/** 清洗流水线状态 */
export type PipelineStatus =
  | 'pending'
  | 'fetching'
  | 'cleaning'
  | 'converting'
  | 'success'
  | 'failed';

/** 清洗结果（Renderer 和 AI 可安全消费的契约） */
export interface CleanedContent {
  entryId: number;
  sourceUrl: string;
  cleanedHtml: string;
  markdown: string;
  readabilityTitle?: string;
  readabilityByline?: string;
  pipelineStatus: PipelineStatus;
  pipelineError?: string;
  segmenterVersion?: string;
  sourceContentHash?: string;
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