import type {
  ExportableArticle,
  PerArticleOptions,
} from '../../shared/contracts/export.types';
import { DEFAULT_PER_ARTICLE_OPTIONS } from '../../shared/contracts/export.types';
import type { EntryAnnotation } from '../../shared/contracts/annotation.types';

// ── 脚注相关公开类型 ───────────────────────────────────────

export interface FootnoteDef {
  index: number;
  selectedText: string;
  noteText?: string;
}

// ── 脚注帮助函数 ───────────────────────────────────────────

/**
 * 扫描 Markdown 中已使用的脚注序号 `[^N]`。
 * 只关注纯数字脚注标记，不匹配 `[^custom-name]`。
 */
export function detectExistingFootnoteNumbers(markdown: string): Set<number> {
  const existing = new Set<number>();
  const regex = /\[\^(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    existing.add(Number(match[1]));
  }
  return existing;
}

/**
 * 截断过长的 selectedText。
 * 超过 120 字符时在 80-120 范围内最后一个词边界截断并追加 …。
 */
function truncateSelectedText(text: string): string {
  if (text.length <= 120) return text;
  const cut = text.lastIndexOf(' ', 120);
  if (cut >= 80) {
    return text.slice(0, cut) + '…';
  }
  return text.slice(0, 100) + '…';
}

/**
 * 在 Markdown 正文中插入脚注引用标记，并生成脚注定义列表。
 *
 * 策略：
 * - 按 startOffset 稳定排序
 * - 从后向前处理（不会因插入标记导致后续匹配偏移）
 * - selectedText 找不到时降级：不插入标记，脚注定义保留
 * - 多段匹配时用 prefixText/suffixText 消歧
 */
export function insertFootnoteMarkers(
  body: string,
  annotations: EntryAnnotation[],
): { modifiedBody: string; footnotes: FootnoteDef[] } {
  if (annotations.length === 0) {
    return { modifiedBody: body, footnotes: [] };
  }

  // 1. 按 startOffset 稳定排序
  const sorted = [...annotations].sort((a, b) => a.startOffset - b.startOffset);

  // 2. 检测已有脚注序号
  const existing = detectExistingFootnoteNumbers(body);
  let nextN = existing.size > 0 ? Math.max(...existing) + 1 : 1;

  // 3. 从后向前处理，避免插入偏移
  let work = body;
  const footnotes: FootnoteDef[] = [];

  for (let i = sorted.length - 1; i >= 0; i--) {
    const ann = sorted[i];
    const n = nextN++;

    const idx = findSelectedTextInMarkdown(work, ann);

    if (idx === -1) {
      // 找不到 → 降级：不插入标记
      footnotes.push({ index: n, selectedText: ann.selectedText, noteText: ann.noteText || undefined });
      continue;
    }

    // 找到 → 在 selectedText 后插入 [^N]
    const marker = `[^${n}]`;
    work = work.slice(0, idx + ann.selectedText.length) + marker + work.slice(idx + ann.selectedText.length);
    footnotes.push({ index: n, selectedText: ann.selectedText, noteText: ann.noteText || undefined });
  }

  // 4. 脚注按 index 升序排列
  footnotes.sort((a, b) => a.index - b.index);

  return { modifiedBody: work, footnotes };
}

/**
 * 在 markdown 中查找 selectedText。
 * 返回匹配位置，或 -1。
 * 多段匹配时使用 prefixText/suffixText 消歧。
 */
function findSelectedTextInMarkdown(markdown: string, ann: EntryAnnotation): number {
  const { selectedText, prefixText, suffixText } = ann;

  // 跳过含换行符的 selectedText（无法在连续字符串中匹配）
  if (selectedText.includes('\n')) return -1;

  const firstIdx = markdown.indexOf(selectedText);
  if (firstIdx === -1) return -1;

  const lastIdx = markdown.lastIndexOf(selectedText);

  // 唯一匹配
  if (firstIdx === lastIdx) return firstIdx;

  // 多段匹配 → 用 prefixText 消歧（找 prefixText + selectedText 的连续匹配）
  if (prefixText) {
    const combined = prefixText + selectedText;
    const idx = markdown.indexOf(combined);
    if (idx !== -1) return idx + prefixText.length;
  }

  // 用 suffixText 消歧
  if (suffixText) {
    const combined = selectedText + suffixText;
    const idx = markdown.indexOf(combined);
    if (idx !== -1) return idx;
  }

  // 无法消歧 → 返回第一个
  return firstIdx;
}

/**
 * 将脚注定义列表序列化为 Markdown 脚注块。
 */
export function serializeFootnotes(footnotes: FootnoteDef[]): string {
  if (footnotes.length === 0) return '';
  return footnotes
    .map((f) => {
      const truncated = truncateSelectedText(f.selectedText);
      if (f.noteText) {
        return `[^${f.index}]: "${truncated}" — ${f.noteText}`;
      }
      return `[^${f.index}]: "${truncated}"`;
    })
    .join('\n');
}

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

  // ── 正文（提前处理脚注标记）──
  parts.push('---');
  let body = article.cleanedMarkdown.trim();
  let footnotes: FootnoteDef[] = [];

  if (opts.includeNotes && article.annotations && article.annotations.length > 0) {
    const result = insertFootnoteMarkers(body, article.annotations);
    body = result.modifiedBody;
    footnotes = result.footnotes;
  }

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

  // ── 笔记（脚注格式优先，旧引用块格式作为 fallback）──
  if (footnotes.length > 0) {
    parts.push('---');
    parts.push(serializeFootnotes(footnotes));
  } else if (opts.includeNotes && article.notes?.trim()) {
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

  // ── 正文（提前处理脚注标记）──
  parts.push('---');
  let body = article.cleanedMarkdown.trim();
  let footnotes: FootnoteDef[] = [];

  if (options.includeNotes && article.annotations && article.annotations.length > 0) {
    const result = insertFootnoteMarkers(body, article.annotations);
    body = result.modifiedBody;
    footnotes = result.footnotes;
  }

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

  // ── 笔记（脚注格式优先，旧引用块格式作为 fallback）──
  if (footnotes.length > 0) {
    parts.push('---');
    parts.push(serializeFootnotes(footnotes));
  } else if (options.includeNotes && article.notes?.trim()) {
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