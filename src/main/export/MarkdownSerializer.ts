import type {
  ExportableArticle,
  PerArticleOptions,
} from '../../shared/contracts/export.types';
import { DEFAULT_PER_ARTICLE_OPTIONS } from '../../shared/contracts/export.types';

/**
 * 将单篇文章序列化为 Markdown 字符串。
 *
 * @param article  导出数据
 * @param options  用户选项（不传则等同于 DEFAULT_PER_ARTICLE_OPTIONS）
 */
export function serializeSingle(
  article: ExportableArticle,
  options?: PerArticleOptions,
): string {
  const opts = options ?? DEFAULT_PER_ARTICLE_OPTIONS;
  const parts: string[] = [];

  // ── 标题 ──
  const title = article.title?.trim() || '(无标题)';
  parts.push(`# ${title}`);

  // ── 元信息（只输出存在的字段）──
  const metaLines: string[] = [];
  if (article.feedTitle?.trim()) {
    metaLines.push(`**来源：** ${article.feedTitle.trim()}`);
  }
  if (article.author?.trim()) {
    metaLines.push(`**作者：** ${article.author.trim()}`);
  }
  if (article.publishedAt?.trim()) {
    metaLines.push(`**发布时间：** ${article.publishedAt.trim()}`);
  }
  if (article.url?.trim()) {
    metaLines.push(`**原文链接：** ${article.url.trim()}`);
  }
  if (metaLines.length > 0) {
    parts.push(metaLines.join('  \n'));
  }

  // ── 正文 ──
  parts.push('---');
  const body = article.cleanedMarkdown.trim();
  parts.push(body || '*(无正文内容)*');

  // ── AI 摘要 ──
  if (opts.includeSummary && article.summary?.trim()) {
    parts.push('---');
    parts.push(`> **AI 摘要：**\n>\n> ${article.summary.trim()}`);
  }

  // ── 翻译 ──
  if (opts.includeTranslation && article.translation?.trim()) {
    parts.push('---');
    parts.push(`> **翻译：**\n>\n> ${article.translation.trim()}`);
  }

  // ── 笔记 ──
  if (opts.includeNotes && article.notes?.trim()) {
    parts.push('---');
    const noteLines = article.notes
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `> - ${l}`);
    parts.push(`> **笔记：**\n>\n${noteLines.join('\n')}`);
  }

  return parts.join('\n\n');
}