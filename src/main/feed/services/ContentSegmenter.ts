import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import type {
  ContentSegment,
  ContentSegmentType,
} from '../../../shared/contracts/content.types';

export const CONTENT_SEGMENTER_VERSION = 'v5';

export interface ContentSegmentMetadata {
  title?: string;
  byline?: string;
}

export interface SegmentedContent {
  segments: ContentSegment[];
  sourceContentHash: string;
  segmenterVersion: typeof CONTENT_SEGMENTER_VERSION;
}

/**
 * Derives a stable, public Translation contract from sanitized Reader HTML.
 * The output intentionally contains only Reader blocks, not cleaner-specific
 * node paths or DOM references.
 */
export class ContentSegmenter {
  segment(
    cleanedHtml: string,
    metadata: ContentSegmentMetadata = {},
  ): SegmentedContent {
    const dom = new JSDOM(`<body>${cleanedHtml}</body>`);
    const elements = Array.from(
      dom.window.document.body.querySelectorAll(
        'h1, h2, h3, h4, h5, h6, p, li, blockquote, cite, pre, figcaption, caption',
      ),
    );
    const segments: ContentSegment[] = [];

    appendTitleSegment(segments, metadata.title);

    for (const element of elements) {
      const type = toSegmentType(element);
      if (!type || shouldSkipElement(element, type)) continue;

      const sourceHtml = getSourceHtml(element, type);
      const sourceText = getSourceText(element, type);
      if (!sourceText) continue;

      if (
        type === 'heading'
        && metadata.title
        && normalizeWhitespace(metadata.title) === sourceText
      ) {
        continue;
      }

      appendSegment(segments, type, sourceHtml, sourceText);
    }

    const payload = segments
      .map((segment) => [
        segment.type,
        String(segment.orderIndex),
        segment.sourceHtml,
        normalizeWhitespace(segment.sourceText),
      ].join('\n'))
      .join('\n---\n');

    return {
      segments,
      sourceContentHash: hash(payload),
      segmenterVersion: CONTENT_SEGMENTER_VERSION,
    };
  }
}

function getSourceText(element: Element, type: ContentSegmentType): string {
  if (type === 'blockquote') {
    if (element.tagName.toLowerCase() !== 'blockquote') {
      return normalizeWhitespace(element.textContent ?? '');
    }
    const blocks = Array.from(element.querySelectorAll(':scope > p, :scope > cite'))
      .map((block) => normalizeWhitespace(block.textContent ?? ''))
      .filter(Boolean);
    return normalizeWhitespace(
      blocks.length ? blocks.join('\n') : element.textContent ?? '',
    );
  }
  if (type !== 'list') return normalizeWhitespace(element.textContent ?? '');

  return readTextWithBlockBoundaries(cloneWithoutNestedLists(element));
}

function getSourceHtml(element: Element, type: ContentSegmentType): string {
  if (type === 'preformatted') {
    return element.outerHTML.replace(/\r\n?/g, '\n').trim();
  }
  const source = type === 'list'
    ? cloneWithoutNestedLists(element)
    : element;
  return normalizeHtml(source.outerHTML);
}

function cloneWithoutNestedLists(element: Element): Element {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll('ul, ol').forEach((list) => list.remove());
  return clone;
}

function readTextWithBlockBoundaries(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll('h1, h2, h3, h4, h5, h6, p, div, li, br')
    .forEach((block) => block.append(' '));
  return normalizeWhitespace(clone.textContent ?? '');
}

function appendTitleSegment(
  segments: ContentSegment[],
  value: string | undefined,
): void {
  const sourceText = normalizeWhitespace(value ?? '');
  if (!sourceText) return;
  const sourceHtml = `<h2 class="translation-reader-title">${escapeHtml(sourceText)}</h2>`;
  appendSegment(segments, 'title', sourceHtml, sourceText);
}

function appendSegment(
  segments: ContentSegment[],
  type: ContentSegmentType,
  sourceHtml: string,
  sourceText: string,
): void {
  const orderIndex = segments.length;
  const idInput = [type, String(orderIndex), sourceHtml, sourceText].join('\n');
  const idHash = hash(idInput).slice(0, 12);
  segments.push({
    id: `seg_${orderIndex}_${idHash}`,
    orderIndex,
    type,
    sourceHtml,
    sourceText,
  });
}

function toSegmentType(element: Element): ContentSegmentType | undefined {
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

function shouldSkipElement(element: Element, type: ContentSegmentType): boolean {
  if (type === 'preformatted') return !isTranslatablePreformattedBlock(element);
  if (type === 'list') return false;
  if (type === 'blockquote') {
    if (element.tagName.toLowerCase() !== 'blockquote') return false;
    return Boolean(element.querySelector(':scope > p, :scope > cite'));
  }
  if (element.parentElement?.closest('li, blockquote, ul, ol')) return true;
  if (type === 'paragraph' && element.closest('figure')) return true;
  return false;
}

const NON_PROSE_DESCENDANT_SELECTOR = [
  'code',
  'math',
  'mjx-container',
  '.katex',
  '.MathJax',
  '[data-language]',
].join(', ');

const NON_PROSE_CLASS_OR_LANGUAGE = [
  /\b(?:code|highlight|highlighting|source-code|code-block|syntax|prettyprint)\b/i,
  /\b(?:language|lang)-[\w-]+\b/i,
  /\b(?:katex|mathjax|math-display|equation|formula)\b/i,
];

const TEX_OR_MATH_NOTATION =
  /(?:\$\$|\\(?:begin|end|frac|sqrt|sum|prod|int|lim|left|right|mathrm|mathbf)\b|[∑∏∫√∞≈≠≤≥⊂⊃∈∉])/u;
const REACTION_ARROW = /(?:-{1,2}>|<=>|⇌|⇋|⟶|→|↔)/u;
const CHEMICAL_FORMULA = /^(?:\d*[A-Z][a-z]?\d*){2,}(?:[+-])?$/;
const CONCLUSIVE_CODE_LINE = [
  /^\s*(?:#!|#include\b|<\/?[a-z][^>]*>)/i,
  /^\s*[{[]\s*["'][^"']+["']\s*:/,
  /^\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\([^)]*\)\s*;?\s*$/,
  /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=/,
  /^\s*(?:npm|npx|node|git|curl|wget|pip|python|docker|kubectl|sudo|apt(?:-get)?|brew)\b/i,
  /(?:=>|::|===|!==|\+\+|--|&&|\|\||\?\.)/,
];
const CODE_LINE_PATTERNS = [
  /^\s*(?:const|let|var|function|class|interface|type|enum|import|export|return|if|else|for|while|switch|try|catch|async|await|def|lambda|public|private|protected|package|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i,
  /[{};]\s*$/,
];

/**
 * Some sites use a styled pre element for prose or an entire article. Keep
 * those blocks translatable while conservatively excluding technical content
 * whose literal form must not be changed.
 */
function isTranslatablePreformattedBlock(element: Element): boolean {
  const rawText = (element.textContent ?? '').replace(/\r\n?/g, '\n').trim();
  if (!hasNaturalLanguageText(rawText)) return false;
  if (element.querySelector(NON_PROSE_DESCENDANT_SELECTOR)) return false;

  const markupHints = [
    element.getAttribute('class') ?? '',
    element.getAttribute('id') ?? '',
    element.getAttribute('data-lang') ?? '',
    element.getAttribute('data-language') ?? '',
  ].join(' ');
  if (NON_PROSE_CLASS_OR_LANGUAGE.some((pattern) => pattern.test(markupHints))) {
    return false;
  }
  if (looksLikeMathOrChemistry(rawText)) return false;
  return !looksLikeCode(rawText);
}

function hasNaturalLanguageText(value: string): boolean {
  return (value.match(/\p{L}/gu) ?? []).length >= 4;
}

function looksLikeMathOrChemistry(value: string): boolean {
  if (TEX_OR_MATH_NOTATION.test(value)) return true;

  const compactLines = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (REACTION_ARROW.test(value)) {
    const formulaCount = (value.match(/\b(?:\d*[A-Z][a-z]?\d*){2,}(?:[+-])?\b/g) ?? [])
      .length;
    if (formulaCount >= 1 || compactLines.length <= 2) return true;
  }

  const tokens = value.match(/[A-Za-z0-9+-]+/g) ?? [];
  if (
    tokens.length > 0
    && tokens.every((token) => CHEMICAL_FORMULA.test(token) || /^\d+$/.test(token))
  ) {
    return true;
  }

  return compactLines.length <= 3
    && compactLines.every((line) => {
      const hasEquationOperator = /(?:=|\^|[+\-*/×÷])/.test(line);
      const wordCount = (line.match(/\p{L}+/gu) ?? []).length;
      return hasEquationOperator && wordCount <= 5;
    });
}

function looksLikeCode(value: string): boolean {
  const lines = value
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());
  let signalCount = 0;
  let codeLineCount = 0;

  for (const line of lines) {
    if (CONCLUSIVE_CODE_LINE.some((pattern) => pattern.test(line))) return true;
    const matches = CODE_LINE_PATTERNS.filter((pattern) => pattern.test(line)).length;
    signalCount += matches;
    if (matches > 0) codeLineCount += 1;
  }

  return signalCount >= 2
    || (lines.length >= 2 && codeLineCount / lines.length >= 0.5);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeHtml(value: string): string {
  return normalizeWhitespace(value)
    .replace(/>\s+/g, '>')
    .replace(/\s+</g, '<');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
