/**
 * Feed URL 规范化与身份判定
 *
 * 职责：
 * - 为 URL 生成规范化的 dedupKey（用于去重匹配）
 * - 不涉及网络请求或数据库访问
 *
 * 规范化规则（团队确认，2025-07-17）：
 * - host 转为小写
 * - 去除默认端口（:443, :80）
 * - 去除片段（#section）
 * - 去除尾部斜杠
 * - 查询参数保留（可能含 token/身份信息）
 * - path 大小写保留
 * - 协议（http/https）保留，不视为同一 Feed
 */

/**
 * 对 Feed URL 进行规范化，返回去重用的 dedupKey。
 *
 * dedupKey 组成：
 *   protocol + "://" + lowercaseHost + [:port_if_non_default] + path (无尾部斜杠)
 *
 * @param url - 用户输入的 Feed URL
 * @returns 规范化的 dedupKey 字符串
 * @throws 如果 URL 格式无效
 */
export function normalizeFeedURL(url: string): string {
  const parsed = new URL(url);

  // Host 转为小写
  parsed.hostname = parsed.hostname.toLowerCase();

  // 去除默认端口
  const defaultPort =
    parsed.protocol === 'https:' ? '443' : parsed.protocol === 'http:' ? '80' : null;
  if (parsed.port && defaultPort && parsed.port === defaultPort) {
    parsed.port = '';
  }

  // 去除片段（#section）
  parsed.hash = '';

  // 去除尾部斜杠（保留根路径 "/"）
  let pathname = parsed.pathname;
  while (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  // 重建 URL 字符串（用 host + pathname + search，不含 hash）
  const portPart = parsed.port ? `:${parsed.port}` : '';
  return `${parsed.protocol}//${parsed.hostname}${portPart}${pathname}${parsed.search}`;
}

/**
 * 判断两个 URL 是否指向同一 Feed（基于规范化后的 dedupKey）
 */
export function isSameFeed(a: string, b: string): boolean {
  return normalizeFeedURL(a) === normalizeFeedURL(b);
}
