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

/**
 * 序列化文章正文部分（不含标题，供多篇导出使用）。
 */
function serializeBody(
  article: ExportableArticle,
  options: PerArticleOptions,
): string {
  const parts: string[] = [];

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
  if (options.includeSummary && article.summary?.trim()) {
    parts.push('---');
    parts.push(`> **AI 摘要：**\n>\n> ${article.summary.trim()}`);
  }

  // ── 翻译 ──
  if (options.includeTranslation && article.translation?.trim()) {
    parts.push('---');
    parts.push(`> **翻译：**\n>\n> ${article.translation.trim()}`);
  }

  // ── 笔记 ──
  if (options.includeNotes && article.notes?.trim()) {
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

/**
 * 将多篇文章序列化为一份文摘 Markdown 字符串。
 *
 * 每篇文章优先使用自身的 exportOptions；若不存在则使用 defaultOptions。
 *
 * @param articles        导出文章列表
 * @param defaultOptions  默认选项（被文章的 exportOptions 覆盖）
 */
export function serializeMultiple(
  articles: ExportableArticle[],
  defaultOptions?: PerArticleOptions,
): string {
  const defaults = defaultOptions ?? DEFAULT_PER_ARTICLE_OPTIONS;
  const now = new Date().toISOString();
  const dateStr = now.slice(0, 10);

  const parts: string[] = [];

  // ── 文件头 ──
  parts.push(`# 文摘 — ${dateStr}`);
  parts.push(`> 共 ${articles.length} 篇文章  \n> 导出时间：${now}`);

  // ── 逐篇文章 ──
  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    const opts = article.exportOptions ?? defaults;
    const title = article.title?.trim() || '(无标题)';
    const body = serializeBody(article, opts);

    parts.push('---');
    parts.push(`## ${i + 1}. ${title}`);
    parts.push(body);
  }

  return parts.join('\n\n');
}