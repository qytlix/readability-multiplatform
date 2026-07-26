import type {
  ExportTranslationSegment,
  ExportableArticle,
  PerArticleOptions,
} from '../../shared/contracts/export.types';
import { DEFAULT_PER_ARTICLE_OPTIONS } from '../../shared/contracts/export.types';
import type { EntryAnnotation } from '../../shared/contracts/annotation.types';
import { JSDOM } from 'jsdom';
import { MarkdownConverter } from '../feed/fetcher/MarkdownConverter';

const TRANSLATABLE_BLOCK_SELECTOR = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'blockquote',
  'cite',
  'pre',
  'figcaption',
  'caption',
].join(', ');

const TRANSLATION_MEDIA_SELECTOR =
  'img, picture, video, audio, iframe, object, embed, svg, canvas';

const markdownConverter = new MarkdownConverter();

// ── 脚注相关公开类型 ───────────────────────────────────────

export interface FootnoteDef {
  index: number;
  selectedText: string;
  noteText?: string;
}

interface SourceTextNode {
  node: Text;
  startOffset: number;
  endOffset: number;
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

    const highlightEnd = findExportHighlightEnd(work, ann.id);
    const idx = highlightEnd === -1
      ? findSelectedTextInMarkdown(work, ann)
      : highlightEnd;

    if (idx === -1) {
      // 找不到 → 降级：不插入标记
      footnotes.push({ index: n, selectedText: ann.selectedText, noteText: ann.noteText || undefined });
      continue;
    }

    // 找到导出高亮时把脚注放在 </mark> 之后；旧数据则仍放在选中文本之后。
    const marker = `[^${n}]`;
    const insertionIndex = highlightEnd === -1
      ? idx + ann.selectedText.length
      : highlightEnd;
    work = work.slice(0, insertionIndex) + marker + work.slice(insertionIndex);
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

function findExportHighlightEnd(markdown: string, annotationId: number): number {
  const attribute = `data-shale-annotation-id="${annotationId}"`;
  let searchOffset = 0;
  let lastEnd = -1;

  while (searchOffset < markdown.length) {
    const attributeIndex = markdown.indexOf(attribute, searchOffset);
    if (attributeIndex === -1) break;
    const tagEnd = markdown.indexOf('>', attributeIndex + attribute.length);
    const closingTag = tagEnd === -1
      ? -1
      : markdown.indexOf('</mark>', tagEnd + 1);
    if (closingTag === -1) break;
    lastEnd = closingTag + '</mark>'.length;
    searchOffset = lastEnd;
  }

  return lastEnd;
}

/**
 * 把逐段译文投影回 Reader HTML 骨架，再转换为 Markdown。
 * 译文使用 blockquote，因此在常见 Markdown 阅读器中会显示左侧竖线。
 */
export function serializeBilingualBody(article: ExportableArticle): string {
  const sourceMarkdown = serializeSourceBody(article);
  const segments = [...(article.translationSegments ?? [])]
    .sort((left, right) => left.orderIndex - right.orderIndex);
  if (!article.cleanedHtml?.trim() || segments.length === 0) {
    return sourceMarkdown;
  }

  const dom = new JSDOM(`<body>${article.cleanedHtml}</body>`);
  const body = dom.window.document.body;
  const candidates = Array.from(
    body.querySelectorAll<HTMLElement>(TRANSLATABLE_BLOCK_SELECTOR),
  ).filter((element) => !shouldSkipTranslationCandidate(element));
  let candidateIndex = 0;
  let insertedCount = 0;

  for (const segment of segments) {
    if (segment.sourceType === 'title' || segment.sourceType === 'byline') continue;

    const matchingIndex = findMatchingTranslationCandidate(
      candidates,
      candidateIndex,
      segment,
    );
    if (matchingIndex === -1) continue;
    candidateIndex = matchingIndex + 1;

    if (!hasDistinctTranslation(segment)) continue;
    const sourceElement = candidates[matchingIndex];
    if (!sourceElement) continue;

    const translatedBlock = createTranslatedBlock(sourceElement, segment);
    insertTranslatedBlock(sourceElement, translatedBlock);
    insertedCount += 1;
  }

  if (insertedCount === 0) return sourceMarkdown;
  applyExportAnnotationHighlights(body, article.annotations ?? []);
  return markdownConverter.convert(body.innerHTML);
}

function serializeSourceBody(article: ExportableArticle): string {
  const sourceMarkdown = article.cleanedMarkdown.trim();
  const annotations = article.annotations ?? [];
  if (annotations.length === 0) return sourceMarkdown;

  if (article.cleanedHtml?.trim()) {
    const dom = new JSDOM(`<body>${article.cleanedHtml}</body>`);
    const body = dom.window.document.body;
    applyExportAnnotationHighlights(body, annotations);
    return markdownConverter.convert(body.innerHTML);
  }

  return applyMarkdownAnnotationHighlights(sourceMarkdown, annotations);
}

function applyExportAnnotationHighlights(
  root: HTMLElement,
  annotations: readonly EntryAnnotation[],
): void {
  if (annotations.length === 0) return;
  const textNodes = collectSourceTextNodes(root);
  const fullText = textNodes.map(({ node }) => node.data).join('');
  const resolved = annotations
    .map((annotation) => resolveAnnotationOffsets(annotation, fullText))
    .filter((range): range is {
      annotation: EntryAnnotation;
      startOffset: number;
      endOffset: number;
    } => range !== null)
    .sort((left, right) => right.startOffset - left.startOffset);

  for (const range of resolved) {
    wrapExportTextRange(root, range);
  }
}

function collectSourceTextNodes(root: HTMLElement): SourceTextNode[] {
  const nodeFilter = root.ownerDocument.defaultView?.NodeFilter;
  if (!nodeFilter) return [];
  const walker = root.ownerDocument.createTreeWalker(
    root,
    nodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => node.parentElement?.closest(
        'script, style, [data-shale-export-translation], '
        + 'mark[data-shale-export-highlight]',
      )
        ? nodeFilter.FILTER_REJECT
        : nodeFilter.FILTER_ACCEPT,
    },
  );
  const textNodes: SourceTextNode[] = [];
  let textOffset = 0;
  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const endOffset = textOffset + textNode.data.length;
    textNodes.push({ node: textNode, startOffset: textOffset, endOffset });
    textOffset = endOffset;
    current = walker.nextNode();
  }
  return textNodes;
}

function resolveAnnotationOffsets(
  annotation: EntryAnnotation,
  fullText: string,
): {
  annotation: EntryAnnotation;
  startOffset: number;
  endOffset: number;
} | null {
  if (
    annotation.startOffset >= 0
    && annotation.endOffset <= fullText.length
    && fullText.slice(annotation.startOffset, annotation.endOffset)
      === annotation.selectedText
  ) {
    return {
      annotation,
      startOffset: annotation.startOffset,
      endOffset: annotation.endOffset,
    };
  }

  const candidates: number[] = [];
  let searchOffset = 0;
  while (searchOffset <= fullText.length - annotation.selectedText.length) {
    const candidate = fullText.indexOf(annotation.selectedText, searchOffset);
    if (candidate < 0) break;
    candidates.push(candidate);
    searchOffset = candidate + Math.max(1, annotation.selectedText.length);
  }
  if (candidates.length === 0) return null;

  const bestStart = candidates.reduce((best, candidate) => {
    const candidateScore = scoreAnnotationContext(annotation, fullText, candidate);
    const bestScore = scoreAnnotationContext(annotation, fullText, best);
    if (candidateScore !== bestScore) {
      return candidateScore > bestScore ? candidate : best;
    }
    return Math.abs(candidate - annotation.startOffset)
      < Math.abs(best - annotation.startOffset)
      ? candidate
      : best;
  });
  return {
    annotation,
    startOffset: bestStart,
    endOffset: bestStart + annotation.selectedText.length,
  };
}

function scoreAnnotationContext(
  annotation: EntryAnnotation,
  fullText: string,
  startOffset: number,
): number {
  const prefix = fullText.slice(
    Math.max(0, startOffset - annotation.prefixText.length),
    startOffset,
  );
  const endOffset = startOffset + annotation.selectedText.length;
  const suffix = fullText.slice(
    endOffset,
    endOffset + annotation.suffixText.length,
  );
  return matchingSuffixLength(prefix, annotation.prefixText)
    + matchingPrefixLength(suffix, annotation.suffixText);
}

function matchingSuffixLength(left: string, right: string): number {
  let matches = 0;
  while (
    matches < left.length
    && matches < right.length
    && left[left.length - matches - 1] === right[right.length - matches - 1]
  ) {
    matches += 1;
  }
  return matches;
}

function matchingPrefixLength(left: string, right: string): number {
  let matches = 0;
  while (
    matches < left.length
    && matches < right.length
    && left[matches] === right[matches]
  ) {
    matches += 1;
  }
  return matches;
}

function wrapExportTextRange(
  root: HTMLElement,
  range: {
    annotation: EntryAnnotation;
    startOffset: number;
    endOffset: number;
  },
): void {
  const textNodes = collectSourceTextNodes(root);
  for (const candidate of textNodes) {
    const intersectionStart = Math.max(range.startOffset, candidate.startOffset);
    const intersectionEnd = Math.min(range.endOffset, candidate.endOffset);
    if (intersectionStart >= intersectionEnd) continue;
    const localStart = intersectionStart - candidate.startOffset;
    const localLength = intersectionEnd - intersectionStart;
    const selectedNode = localStart > 0
      ? candidate.node.splitText(localStart)
      : candidate.node;
    if (localLength < selectedNode.data.length) {
      selectedNode.splitText(localLength);
    }
    const mark = root.ownerDocument.createElement('mark');
    mark.dataset.shaleExportHighlight = '';
    mark.dataset.annotationId = String(range.annotation.id);
    mark.dataset.annotationColor = range.annotation.color;
    selectedNode.parentNode?.insertBefore(mark, selectedNode);
    mark.append(selectedNode);
  }
}

function applyMarkdownAnnotationHighlights(
  markdown: string,
  annotations: readonly EntryAnnotation[],
): string {
  const matches = annotations
    .map((annotation) => ({
      annotation,
      index: findSelectedTextInMarkdown(markdown, annotation),
    }))
    .filter(({ index }) => index >= 0)
    .sort((left, right) => right.index - left.index);
  let highlighted = markdown;

  for (const { annotation, index } of matches) {
    const end = index + annotation.selectedText.length;
    const opening = `<mark data-shale-highlight="${annotation.color}" `
      + `data-shale-annotation-id="${annotation.id}" `
      + `style="background-color: ${getHighlightColor(annotation.color)};">`;
    highlighted = highlighted.slice(0, index)
      + opening
      + highlighted.slice(index, end)
      + '</mark>'
      + highlighted.slice(end);
  }
  return highlighted;
}

function getHighlightColor(color: EntryAnnotation['color']): string {
  switch (color) {
    case 'green': return '#7ed391';
    case 'blue': return '#69b5eb';
    case 'pink': return '#ec84ab';
    case 'yellow': return '#f4d35e';
  }
}

function quoteMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line ? `> ${line}` : '>')
    .join('\n');
}

function serializeSummary(summary: string, headingLevel: 2 | 3 = 2): string {
  return `${'#'.repeat(headingLevel)} AI SUMMARY\n\n${quoteMarkdown(summary.trim())}`;
}

function serializeLegacyTranslation(translation: string): string {
  return quoteMarkdown(`**翻译：**\n\n${translation.trim()}`);
}

function serializeTranslatedTitle(
  segments: readonly ExportTranslationSegment[] | undefined,
): string | undefined {
  const translatedTitle = segments
    ?.find((segment) => segment.sourceType === 'title' && hasDistinctTranslation(segment))
    ?.translatedText
    ?.trim();
  return translatedTitle ? quoteMarkdown(translatedTitle) : undefined;
}

function hasDistinctTranslation(segment: ExportTranslationSegment): boolean {
  const translatedText = normalizeWhitespace(segment.translatedText ?? '');
  if (!translatedText) return false;
  if (translatedText !== normalizeWhitespace(segment.sourceText)) return true;
  return Boolean(
    segment.translatedHtml
    && normalizeSegmentHtml(segment.translatedHtml, segment.sourceType)
      !== normalizeSegmentHtml(segment.sourceHtml, segment.sourceType),
  );
}

function findMatchingTranslationCandidate(
  candidates: readonly HTMLElement[],
  startIndex: number,
  segment: ExportTranslationSegment,
): number {
  const expectedHtml = normalizeSegmentHtml(segment.sourceHtml, segment.sourceType);
  for (let index = startIndex; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (
      candidate
      && toSegmentType(candidate) === segment.sourceType
      && getCandidateHtml(candidate, segment.sourceType) === expectedHtml
    ) {
      return index;
    }
  }
  return -1;
}

function createTranslatedBlock(
  sourceElement: HTMLElement,
  segment: ExportTranslationSegment,
): HTMLElement {
  const blockquote = sourceElement.ownerDocument.createElement('blockquote');
  blockquote.setAttribute('data-shale-export-translation', '');

  if (segment.translatedHtml) {
    blockquote.innerHTML = getTranslatedContent(sourceElement, segment.translatedHtml);
  } else {
    const paragraph = sourceElement.ownerDocument.createElement('p');
    paragraph.textContent = segment.translatedText ?? '';
    blockquote.append(paragraph);
  }

  blockquote.querySelectorAll(TRANSLATION_MEDIA_SELECTOR)
    .forEach((element) => element.remove());
  return blockquote;
}

function getTranslatedContent(
  sourceElement: HTMLElement,
  translatedHtml: string,
): string {
  if (sourceElement.tagName.toLowerCase() !== 'li') return translatedHtml;
  const template = sourceElement.ownerDocument.createElement('template');
  template.innerHTML = translatedHtml;
  const translatedRoot = template.content.firstElementChild;
  return translatedRoot?.tagName.toLowerCase() === 'li'
    ? translatedRoot.innerHTML
    : translatedHtml;
}

function insertTranslatedBlock(
  sourceElement: HTMLElement,
  translatedBlock: HTMLElement,
): void {
  if (sourceElement.tagName.toLowerCase() !== 'li') {
    sourceElement.insertAdjacentElement('afterend', translatedBlock);
    return;
  }
  const nestedList = sourceElement.querySelector(':scope > ul, :scope > ol');
  if (nestedList) {
    nestedList.insertAdjacentElement('beforebegin', translatedBlock);
    return;
  }
  sourceElement.append(translatedBlock);
}

function getCandidateHtml(
  element: HTMLElement,
  type: ExportTranslationSegment['sourceType'],
): string {
  if (type === 'preformatted') {
    return element.outerHTML.replace(/\r\n?/g, '\n').trim();
  }
  const source = type === 'list'
    ? cloneWithoutNestedLists(element)
    : element;
  return normalizeSegmentHtml(source.outerHTML, type);
}

function normalizeSegmentHtml(
  value: string,
  type: ExportTranslationSegment['sourceType'],
): string {
  if (type === 'preformatted') return value.replace(/\r\n?/g, '\n').trim();
  return normalizeWhitespace(value)
    .replace(/>\s+/g, '>')
    .replace(/\s+</g, '<');
}

function cloneWithoutNestedLists(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('ul, ol').forEach((list) => list.remove());
  return clone;
}

function shouldSkipTranslationCandidate(element: HTMLElement): boolean {
  const type = toSegmentType(element);
  if (type === 'list') return false;
  if (type === 'blockquote') {
    if (element.tagName.toLowerCase() !== 'blockquote') return false;
    return Boolean(element.querySelector(':scope > p, :scope > cite'));
  }
  if (element.parentElement?.closest('li, blockquote, ul, ol')) return true;
  return element.tagName.toLowerCase() === 'p' && Boolean(element.closest('figure'));
}

function toSegmentType(
  element: HTMLElement,
): ExportTranslationSegment['sourceType'] | undefined {
  const tagName = element.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tagName)) return 'heading';
  if (
    tagName === 'blockquote'
    || ((tagName === 'p' || tagName === 'cite')
      && element.parentElement?.tagName.toLowerCase() === 'blockquote')
  ) {
    return 'blockquote';
  }
  if (tagName === 'p') return 'paragraph';
  if (tagName === 'li') return 'list';
  if (tagName === 'pre') return 'preformatted';
  if (tagName === 'figcaption' || tagName === 'caption') return 'caption';
  return undefined;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
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

  // ── 标题翻译与 AI 摘要（与 Reader 顶部顺序一致）──
  if (opts.includeTranslation) {
    const translatedTitle = serializeTranslatedTitle(article.translationSegments);
    if (translatedTitle) parts.push(translatedTitle);
  }
  if (opts.includeSummary && article.summary?.trim()) {
    parts.push(serializeSummary(article.summary));
  }

  // ── 正文（提前处理脚注标记）──
  parts.push('---');
  let body = opts.includeTranslation
    ? serializeBilingualBody(article)
    : serializeSourceBody(article);
  let footnotes: FootnoteDef[] = [];

  if (opts.includeNotes && article.annotations && article.annotations.length > 0) {
    const result = insertFootnoteMarkers(body, article.annotations);
    body = result.modifiedBody;
    footnotes = result.footnotes;
  }

  parts.push(body || '*(无正文内容)*');

  // 旧导出数据没有逐段契约时，保留全文翻译 fallback。
  if (
    opts.includeTranslation
    && !article.translationSegments?.length
    && article.translation?.trim()
  ) {
    parts.push('---');
    parts.push(serializeLegacyTranslation(article.translation));
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

  // ── 标题翻译与 AI 摘要（与 Reader 顶部顺序一致）──
  if (options.includeTranslation) {
    const translatedTitle = serializeTranslatedTitle(article.translationSegments);
    if (translatedTitle) parts.push(translatedTitle);
  }
  if (options.includeSummary && article.summary?.trim()) {
    parts.push(serializeSummary(article.summary, 3));
  }

  // ── 正文（提前处理脚注标记）──
  parts.push('---');
  let body = options.includeTranslation
    ? serializeBilingualBody(article)
    : serializeSourceBody(article);
  let footnotes: FootnoteDef[] = [];

  if (options.includeNotes && article.annotations && article.annotations.length > 0) {
    const result = insertFootnoteMarkers(body, article.annotations);
    body = result.modifiedBody;
    footnotes = result.footnotes;
  }

  parts.push(body || '*(无正文内容)*');

  // 旧导出数据没有逐段契约时，保留全文翻译 fallback。
  if (
    options.includeTranslation
    && !article.translationSegments?.length
    && article.translation?.trim()
  ) {
    parts.push('---');
    parts.push(serializeLegacyTranslation(article.translation));
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
