import type { PerArticleOptions } from '../../shared/contracts/export.types';

const EXPORT_OPTION_LABELS = [
  ['includeTranslation', '翻译'],
  ['includeSummary', '总结'],
  ['includeNotes', '笔记'],
] as const satisfies ReadonlyArray<readonly [keyof PerArticleOptions, string]>;

const MAX_SAFE_FILENAME_LENGTH = 200;

/**
 * 从文章标题生成安全文件名。
 *
 * 过滤规则：
 * 1. 替换 `\ / : * ? " < > |` 为空格
 * 2. 合并连续空格
 * 3. 去除首尾空格和点号
 * 4. 截断到 200 字符
 * 5. 如果结果为空，返回 "untitled"
 */
export function safeFilename(title: string): string {
  // 1. 替换非法文件名字符为空格
  let result = title.replace(/[\\/:*?"<>|]/g, ' ');

  // 2. 合并连续空格
  result = result.replace(/\s+/g, ' ');

  // 3. 去除首尾空格和点号
  result = result.replace(/^[\s.]+|[\s.]+$/g, '');

  // 4. 截断到 200 字符
  if (result.length > MAX_SAFE_FILENAME_LENGTH) {
    result = result.slice(0, MAX_SAFE_FILENAME_LENGTH);
  }

  // 5. 如果结果为空，返回 "untitled"
  if (result.length === 0) {
    return 'untitled';
  }

  return result;
}

/**
 * 生成 Markdown 导出的默认文件名。
 *
 * 所有文章实际勾选的附加内容取并集，并以固定顺序追加到文件名末尾。
 * 截断时优先保留选项后缀，确保用户能从文件名判断导出的内容类型。
 */
export function markdownExportFilename(
  baseName: string,
  options: readonly PerArticleOptions[],
): string {
  const selectedLabels = EXPORT_OPTION_LABELS
    .filter(([field]) => options.some((articleOptions) => articleOptions[field]))
    .map(([, label]) => label);
  const suffix = selectedLabels.length > 0
    ? `（${selectedLabels.join('、')}）`
    : '';
  const safeBaseName = safeFilename(baseName);
  const availableBaseLength = Math.max(
    1,
    MAX_SAFE_FILENAME_LENGTH - suffix.length,
  );
  const truncatedBaseName = safeBaseName
    .slice(0, availableBaseLength)
    .replace(/[\s.]+$/g, '') || 'untitled';

  return `${truncatedBaseName}${suffix}.md`;
}
