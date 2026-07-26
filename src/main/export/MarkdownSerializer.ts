import { JSDOM } from 'jsdom';
import { MarkdownConverter } from '../feed/fetcher/MarkdownConverter';
import type {
  ExportableArticle,
  PerArticleOptions,
} from '../../shared/contracts/export.types';
import { DEFAULT_PER_ARTICLE_OPTIONS } from '../../shared/contracts/export.types';
import type { EntryAnnotation } from '../../shared/contracts/annotation.types';
import type { TranslationSegment } from '../../shared/contracts/translation.types';

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
  const baseN = existing.size > 0 ? Math.max(...existing) + 1 : 1;

  // 3. 预先按顺序分配编号（已排序的 annotation 获得连续编号）
  const numbered = sorted.map((ann, i) => ({ annotation: ann, n: baseN + i }));

  // 4. 从后向前处理，避免插入偏移
  let work = body;
  const footnotes: FootnoteDef[] = [];

  for (let i = numbered.length - 1; i >= 0; i--) {
    const { annotation: ann, n } = numbered[i];

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

  // 5. 脚注按 index 升序排列
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

  // Interleaved translation: inject blockquotes into the body
  if (opts.includeTranslation && article.translationSegments && article.translationSegments.length > 0) {
    body = serializeInterleavedTranslation(
      article.cleanedHtml,
      body,
      article.translationSegments,
    );
  }

  parts.push(body || '*(无正文内容)*');

  // ── AI 摘要 ──
  if (opts.includeSummary && article.summary?.trim()) {
    parts.push('---');
    parts.push(`> **AI 摘要：**\n>\n> ${article.summary.trim()}`);
  }

  // ── 翻译（旧格式，仅在未使用 interleaved 时输出）──
  if (opts.includeTranslation
    && !(article.translationSegments && article.translationSegments.length > 0)
    && article.translation?.trim()
  ) {
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

  // Interleaved translation: inject blockquotes into the body
  if (options.includeTranslation && article.translationSegments && article.translationSegments.length > 0) {
    body = serializeInterleavedTranslation(
      article.cleanedHtml,
      body,
      article.translationSegments,
    );
  }

  parts.push(body || '*(无正文内容)*');

  // ── AI 摘要 ──
  if (options.includeSummary && article.summary?.trim()) {
    parts.push('---');
    parts.push(`> **AI 摘要：**\n>\n> ${article.summary.trim()}`);
  }

  // ── 翻译（旧格式，仅在未使用 interleaved 时输出）──
  if (options.includeTranslation
    && !(article.translationSegments && article.translationSegments.length > 0)
    && article.translation?.trim()
  ) {
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

// ── Interleaved Translation (Bilingual) ──────────────────────

/**
 * Shared MarkdownConverter instance (Turndown is stateless).
 */
const mdConverter = new MarkdownConverter();

/**
 * Translatable block selectors — same as ContentSegmenter.
 */
const TRANSLATABLE_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'li', 'blockquote', 'cite', 'figcaption', 'caption',
].join(', ');

/**
 * Build an interleaved (bilingual) body from translation segments.
 *
 * Uses DOM-based matching for accuracy: parses cleanedHtml and walks body
 * children in document order, matching each translatable element against
 * translation segments by sourceText (plain text). Non-translatable content
 * (figures, tables, code blocks) is preserved as-is.
 *
 * Falls back to Turndown-based text matching when cleanedHtml is unavailable.
 *
 * @param cleanedHtml  清洗后的 HTML（用于 DOM 匹配）。不传时使用 markdown 文本匹配作为 fallback。
 * @param cleanedMarkdown  清洗后的 Markdown 全文（fallback 使用）
 * @param segments  翻译 segments
 */
export function serializeInterleavedTranslation(
  cleanedHtml: string | undefined,
  cleanedMarkdown: string,
  segments: TranslationSegment[],
): string {
  const active = segments.filter(
    (s) => s.status === 'succeeded'
      && s.translatedText
      && s.sourceType !== 'title'
      && s.sourceType !== 'byline',
  );
  if (active.length === 0) return cleanedMarkdown;

  if (cleanedHtml) {
    return serializeByHtmlDom(cleanedHtml, active, mdConverter);
  }

  // Fallback: text matching on cleanedMarkdown
  return serializeByTextMatching(cleanedMarkdown, active);
}

/**
 * DOM-based serialization: walks cleanedHtml body children in order,
 * matching each translatable element against translation segments.
 * Handles <ul>/<ol> containers by iterating their <li> children.
 */
function serializeByHtmlDom(
  cleanedHtml: string,
  segments: TranslationSegment[],
  converter: MarkdownConverter,
): string {
  const dom = new JSDOM(`<body>${cleanedHtml}</body>`);
  const body = dom.window.document.body;
  const result: string[] = [];
  let segIndex = 0;

  for (const child of Array.from(body.children)) {
    const tag = child.tagName.toLowerCase();

    // Handle <ul>/<ol> containers: iterate their <li> children
    if (tag === 'ul' || tag === 'ol') {
      const listItems = Array.from(child.children).filter(
        (c) => c.tagName.toLowerCase() === 'li',
      );
      segIndex = processListContainer(
        result, converter, listItems, segments, segIndex,
      );
      continue;
    }

    const segType = domElementToSegmentType(child);
    if (!segType || shouldSkipTranslatable(child)) {
      // Non-translatable — convert to markdown as-is
      result.push(converter.convert(child.outerHTML).trim());
      continue;
    }

    const childText = normalizeWhitespaceFn(child.textContent ?? '');
    const matched = findMatchingSegment(segments, segIndex, segType, childText);

    if (matched) {
      segIndex = matched.nextIndex;
      const originalMd = segmentToMarkdown(converter, child, segType);
      result.push(originalMd);
      result.push(`> ${matched.segment.translatedText!.trim()}`);
    } else {
      // No matching translation — output original only
      result.push(converter.convert(child.outerHTML).trim());
    }
  }

  return result.join('\n\n');
}

/**
 * Process <li> children: match against 'list'-type translation segments
 * in order, output each as markdown followed by translation blockquote.
 * Returns the new segment index after processing all list items.
 */
function processListContainer(
  result: string[],
  converter: MarkdownConverter,
  listItems: Element[],
  segments: TranslationSegment[],
  startIndex: number,
): number {
  let segIndex = startIndex;

  for (const li of listItems) {
    const liText = normalizeWhitespaceFn(li.textContent ?? '');
    const matched = findMatchingSegment(segments, segIndex, 'list', liText);

    if (matched) {
      segIndex = matched.nextIndex;
      // Convert single li wrapped in ul to preserve list formatting
      const originalMd = converter.convert(`<ul>${li.outerHTML}</ul>`).trim();
      result.push(originalMd);
      result.push(`> ${matched.segment.translatedText!.trim()}`);
    } else {
      // No translation — output original only
      result.push(converter.convert(`<ul>${li.outerHTML}</ul>`).trim());
    }
  }

  return segIndex;
}

interface MatchResult {
  segment: TranslationSegment;
  nextIndex: number;
}

/**
 * Find a matching translation segment starting from segIndex.
 * Matches by sourceType and sourceText (plain text).
 */
function findMatchingSegment(
  segments: TranslationSegment[],
  startIndex: number,
  elementType: string | undefined,
  elementText: string,
): MatchResult | undefined {
  for (let i = startIndex; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg.translatedText) continue;
    // Skip segments whose type doesn't match or until we find a match
    if (seg.sourceType === elementType
      && normalizeWhitespaceFn(seg.sourceText) === elementText
    ) {
      // Consume this segment and all skipped ones before it
      // (the skipped ones had no matching DOM element)
      return { segment: seg, nextIndex: i + 1 };
    }
  }
  return undefined;
}

/**
 * Fallback: text-matching approach on cleanedMarkdown (used when cleanedHtml is unavailable).
 */
function serializeByTextMatching(
  body: string,
  segments: TranslationSegment[],
): string {
  let result = body;
  let searchPos = 0;

  for (const segment of segments) {
    const translatedText = segment.translatedText?.trim();
    if (!translatedText) continue;

    // Use sourceText (plain text) for matching, strip any markdown from body
    const sourceText = normalizeWhitespaceFn(segment.sourceText);
    if (!sourceText) continue;

    // Find sourceText in the markdown body, allowing for markdown formatting
    // by progressively relaxing the search
    const idx = findTextInMarkdown(result, sourceText, searchPos);
    if (idx === -1) {
      const fallbackIdx = findTextInMarkdown(result, sourceText, 0);
      if (fallbackIdx === -1 || fallbackIdx < searchPos - 300) continue;
      searchPos = fallbackIdx;
    } else {
      searchPos = idx;
    }

    // Find end of this paragraph (next double newline or end of string)
    let paraEnd = result.indexOf('\n\n', searchPos);
    if (paraEnd === -1) paraEnd = result.length;
    const block = `\n\n> ${translatedText}`;

    result = result.slice(0, paraEnd) + block + result.slice(paraEnd);
    searchPos = paraEnd + block.length;
  }

  return result;
}

/**
 * Find plain text in markdown body, accounting for markdown formatting.
 * E.g., searching for "This is bold text" will match "This is **bold** text".
 */
function findTextInMarkdown(markdown: string, plainText: string, fromIndex: number): number {
  if (!plainText) return -1;
  // Try exact substring first (fast path)
  const exactIdx = markdown.indexOf(plainText, fromIndex);
  if (exactIdx !== -1) return exactIdx;

  // Fallback: strip markdown and search
  const stripped = markdown
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/`(.+?)`/g, '$1');

  const idx = stripped.indexOf(plainText, fromIndex);
  if (idx === -1) return -1;

  // Map back to original position: find the position in original text
  // that corresponds to this position in stripped text
  return mapStrippedToOriginal(markdown, idx);
}

/**
 * Map a position in the stripped text back to the original markdown.
 * Simple heuristic: walk both strings in parallel until we reach the target position.
 */
function mapStrippedToOriginal(original: string, strippedPos: number): number {
  let oi = 0;
  let si = 0;
  const stripped = original
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/`(.+?)`/g, '$1');

  while (si < strippedPos && oi < original.length) {
    if (oi >= original.length) break;
    const oc = original[oi];

    // Check if we're at a markdown sequence
    if (original.startsWith('**', oi)) {
      oi += 2; // skip opening **
      // Read until closing **
      const closeIdx = original.indexOf('**', oi);
      if (closeIdx !== -1) {
        const contentLen = closeIdx - oi;
        oi = closeIdx + 2; // skip past closing **
        si += contentLen;
        continue;
      }
    }
    if (oc === '*' && original.length > oi + 1 && original[oi + 1] !== '*') {
      // Single * for italic — skip opening, find closing
      oi += 1;
      const closeIdx = original.indexOf('*', oi);
      if (closeIdx !== -1) {
        const contentLen = closeIdx - oi;
        oi = closeIdx + 1;
        si += contentLen;
        continue;
      }
    }
    if (oc === '[') {
      // Link — skip to ] then skip (url)
      const closeBracket = original.indexOf(']', oi);
      if (closeBracket !== -1) {
        const contentLen = closeBracket - oi - 1; // text inside [ ]
        const closeParen = original.indexOf(')', closeBracket);
        if (closeParen !== -1) {
          oi = closeParen + 1;
          si += contentLen;
          continue;
        }
      }
    }
    if (oc === '`') {
      // Inline code
      const closeBacktick = original.indexOf('`', oi + 1);
      if (closeBacktick !== -1) {
        const contentLen = closeBacktick - oi - 1;
        oi = closeBacktick + 1;
        si += contentLen;
        continue;
      }
    }

    oi++;
    si++;
  }

  return oi;
}

/**
 * Convert a DOM element to Markdown. Handles list items by wrapping in <ul>.
 */
function segmentToMarkdown(
  converter: MarkdownConverter,
  element: Element,
  segType: string | undefined,
): string {
  if (segType === 'list') {
    return converter.convert(`<ul>${element.outerHTML}</ul>`).trim();
  }
  return converter.convert(element.outerHTML).trim();
}

/**
 * Determine the segment type from a DOM element's tag name.
 * Mirrors ContentSegmenter.toSegmentType.
 */
function domElementToSegmentType(element: Element): string | undefined {
  const tag = element.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'p') return 'paragraph';
  if (tag === 'li') return 'list';
  if (tag === 'blockquote' || tag === 'cite') return 'blockquote';
  if (tag === 'figcaption' || tag === 'caption') return 'caption';
  return undefined;
}

/**
 * Check if a translatable element should be skipped (nested inside list/blockquote).
 * Mirrors ContentSegmenter.shouldSkipElement.
 */
function shouldSkipTranslatable(element: Element): boolean {
  if (element.tagName.toLowerCase() === 'li') return false;
  if (element.parentElement?.closest('li, blockquote, ul, ol')) return true;
  if (element.tagName.toLowerCase() === 'p' && element.closest('figure')) return true;
  return false;
}

/**
 * Normalize whitespace for text comparison.
 */
function normalizeWhitespaceFn(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}