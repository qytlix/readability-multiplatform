/** Feed 模块统一错误结构 */
export interface ShaleError {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

/** 错误码常量 */
export const FEED_ERROR_CODES = {
  FEED_INVALID_URL: 'FEED_INVALID_URL',
  FEED_DUPLICATE: 'FEED_DUPLICATE',
  FEED_FETCH_FAILED: 'FEED_FETCH_FAILED',
  FEED_PARSE_FAILED: 'FEED_PARSE_FAILED',
  FEED_SYNC_IN_PROGRESS: 'FEED_SYNC_IN_PROGRESS',
  ENTRY_FETCH_FAILED: 'ENTRY_FETCH_FAILED',
  CONTENT_CLEAN_FAILED: 'CONTENT_CLEAN_FAILED',
  CONTENT_PARSE_FAILED: 'CONTENT_PARSE_FAILED',
  OPML_INVALID: 'OPML_INVALID',
  OPML_PARSE_FAILED: 'OPML_PARSE_FAILED',
} as const;

export const createFeedError = (
  code: keyof typeof FEED_ERROR_CODES,
  message: string,
  retryable: boolean,
  details?: unknown,
): ShaleError => ({
  code: FEED_ERROR_CODES[code],
  message,
  retryable,
  details,
});