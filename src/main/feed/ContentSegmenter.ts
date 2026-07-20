import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import type {
  ContentSegment,
  ContentSegmentType,
} from '../../shared/contracts/content.types';

export const CONTENT_SEGMENTER_VERSION = 'v2';

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
        'h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, figcaption, caption',
      ),
    );
    const segments: ContentSegment[] = [];

    appendMetadataSegment(segments, 'title', metadata.title, 'h2');
    appendMetadataSegment(segments, 'byline', metadata.byline, 'p');

    for (const element of elements) {
      const tagName = element.tagName.toLowerCase();
      const type = toSegmentType(tagName);
      if (!type || shouldSkipElement(element, type)) continue;

      const sourceHtml = normalizeHtml(element.outerHTML);
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
        normalizeHtml(segment.sourceHtml),
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
    const blocks = Array.from(element.querySelectorAll(':scope > p, :scope > cite'))
      .map((block) => normalizeWhitespace(block.textContent ?? ''))
      .filter(Boolean);
    return normalizeWhitespace(blocks.join('\n'));
  }
  if (type !== 'list') return normalizeWhitespace(element.textContent ?? '');

  const items = Array.from(element.querySelectorAll(':scope > li'))
    .map((item) => readTextWithBlockBoundaries(item))
    .filter(Boolean);
  return normalizeWhitespace(items.join('\n'));
}

function readTextWithBlockBoundaries(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll('h1, h2, h3, h4, h5, h6, p, div, li, br')
    .forEach((block) => block.append(' '));
  return normalizeWhitespace(clone.textContent ?? '');
}

function appendMetadataSegment(
  segments: ContentSegment[],
  type: 'title' | 'byline',
  value: string | undefined,
  tagName: 'h2' | 'p',
): void {
  const sourceText = normalizeWhitespace(value ?? '');
  if (!sourceText) return;
  const className = type === 'title'
    ? 'translation-reader-title'
    : 'translation-reader-byline';
  const sourceHtml = `<${tagName} class="${className}">${escapeHtml(sourceText)}</${tagName}>`;
  appendSegment(segments, type, sourceHtml, sourceText);
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

function toSegmentType(tagName: string): ContentSegmentType | undefined {
  if (/^h[1-6]$/.test(tagName)) return 'heading';
  if (tagName === 'p') return 'paragraph';
  if (tagName === 'ul' || tagName === 'ol') return 'list';
  if (tagName === 'blockquote') return 'blockquote';
  if (tagName === 'figcaption' || tagName === 'caption') return 'caption';
  return undefined;
}

function shouldSkipElement(element: Element, type: ContentSegmentType): boolean {
  if (element.parentElement?.closest('li, blockquote, ul, ol')) return true;
  if (type === 'paragraph' && element.closest('figure')) return true;
  return false;
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
