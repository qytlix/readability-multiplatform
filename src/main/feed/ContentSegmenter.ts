import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import type {
  ContentSegment,
  ContentSegmentType,
} from '../../shared/contracts/content.types';

export const CONTENT_SEGMENTER_VERSION = 'v1';

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
  segment(cleanedHtml: string): SegmentedContent {
    const dom = new JSDOM(`<body>${cleanedHtml}</body>`);
    const elements = Array.from(
      dom.window.document.body.querySelectorAll('p, ul, ol'),
    );
    const segments: ContentSegment[] = [];

    for (const element of elements) {
      const type = element.tagName.toLowerCase() as ContentSegmentType;
      if (type === 'p' && element.closest('li')) continue;

      const sourceHtml = normalizeHtml(element.outerHTML);
      const sourceText = getSourceText(element, type);
      if (!sourceText) continue;

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
  if (type === 'p') return normalizeWhitespace(element.textContent ?? '');

  const items = Array.from(element.querySelectorAll(':scope > li'))
    .map((item) => normalizeWhitespace(item.textContent ?? ''))
    .filter(Boolean);
  return normalizeWhitespace(items.join('\n'));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeHtml(value: string): string {
  return normalizeWhitespace(value)
    .replace(/>\s+/g, '>')
    .replace(/\s+</g, '<');
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
