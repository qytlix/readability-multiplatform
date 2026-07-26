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
  if (result.length > 200) {
    result = result.slice(0, 200);
  }

  // 5. 如果结果为空，返回 "untitled"
  if (result.length === 0) {
    return 'untitled';
  }

  return result;
}