import type { TranslationSegment } from '../../../shared/contracts/translation.types';

const TRANSLATABLE_BLOCK_SELECTOR = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'ul',
  'ol',
  'blockquote',
  'figcaption',
  'caption',
].join(', ');

interface ProjectionState {
  showPendingIndicators: boolean;
}

/**
 * Projects translations onto a sanitized Reader HTML tree.
 *
 * The Reader tree remains the layout source of truth so non-translatable
 * content such as figures, standalone images, tables, and code blocks stays
 * in its original position. Only translated text blocks are inserted.
 */
export function projectBilingualBody(
  root: HTMLElement,
  segments: readonly TranslationSegment[],
  state: ProjectionState,
): void {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(TRANSLATABLE_BLOCK_SELECTOR))
    .filter((element) => !shouldSkipElement(element));
  let candidateIndex = 0;

  for (const segment of segments) {
    if (segment.sourceType === 'title' || segment.sourceType === 'byline') continue;

    const matchingIndex = findMatchingCandidate(candidates, candidateIndex, segment);
    if (matchingIndex === -1) continue;
    candidateIndex = matchingIndex + 1;

    const sourceElement = candidates[matchingIndex];
    if (!sourceElement) continue;
    sourceElement.classList.add('translation-bilingual-source-block');
    sourceElement.dataset.segmentId = segment.sourceSegmentId;
    if (segment.status === 'succeeded' && segment.translatedHtml) {
      sourceElement.insertAdjacentElement('afterend', createTranslatedElement(sourceElement, segment));
    } else if (state.showPendingIndicators && segment.status === 'pending') {
      appendPendingIndicator(sourceElement);
    }
  }
}

function findMatchingCandidate(
  candidates: readonly HTMLElement[],
  startIndex: number,
  segment: TranslationSegment,
): number {
  for (let index = startIndex; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (
      candidate
      && toSegmentType(candidate.tagName) === segment.sourceType
      && getSourceText(candidate, segment.sourceType) === normalizeWhitespace(segment.sourceText)
    ) {
      return index;
    }
  }
  return -1;
}

function createTranslatedElement(
  sourceElement: HTMLElement,
  segment: TranslationSegment,
): HTMLElement {
  const target = sourceElement.ownerDocument.createElement('div');
  target.className = [
    'translation-bilingual-target',
    'entry-detail-html',
    `translation-segment-${segment.sourceType}`,
  ].join(' ');

  target.innerHTML = segment.translatedHtml ?? '';
  // The original media is already present in the Reader skeleton. Avoid
  // duplicating inline images that were part of a translatable paragraph.
  target.querySelectorAll('img, picture, video, audio, iframe, object, embed, svg, canvas')
    .forEach((element) => element.remove());
  return target;
}

function appendPendingIndicator(sourceElement: HTMLElement): void {
  const indicator = sourceElement.ownerDocument.createElement('span');
  indicator.className = 'translation-segment-spinner';
  indicator.setAttribute('role', 'img');
  indicator.setAttribute('aria-label', 'Translating this segment');

  const tagName = sourceElement.tagName.toLowerCase();
  if (tagName === 'ul' || tagName === 'ol') {
    (sourceElement.querySelector(':scope > li:last-child') ?? sourceElement).append(indicator);
    return;
  }
  if (tagName === 'blockquote') {
    (sourceElement.querySelector(':scope > p:last-of-type, :scope > cite:last-of-type')
      ?? sourceElement).append(indicator);
    return;
  }
  sourceElement.append(indicator);
}

function shouldSkipElement(element: HTMLElement): boolean {
  if (element.parentElement?.closest('li, blockquote, ul, ol')) return true;
  return element.tagName.toLowerCase() === 'p' && Boolean(element.closest('figure'));
}

function toSegmentType(tagName: string): TranslationSegment['sourceType'] | undefined {
  const normalizedTag = tagName.toLowerCase();
  if (/^h[1-6]$/.test(normalizedTag)) return 'heading';
  if (normalizedTag === 'p') return 'paragraph';
  if (normalizedTag === 'ul' || normalizedTag === 'ol') return 'list';
  if (normalizedTag === 'blockquote') return 'blockquote';
  if (normalizedTag === 'figcaption' || normalizedTag === 'caption') return 'caption';
  return undefined;
}

function getSourceText(
  element: HTMLElement,
  type: TranslationSegment['sourceType'],
): string {
  if (type === 'blockquote') {
    return normalizeWhitespace(Array.from(element.querySelectorAll(':scope > p, :scope > cite'))
      .map((block) => normalizeWhitespace(block.textContent ?? ''))
      .filter(Boolean)
      .join('\n'));
  }
  if (type !== 'list') return normalizeWhitespace(element.textContent ?? '');

  return normalizeWhitespace(Array.from(element.querySelectorAll(':scope > li'))
    .map((item) => readTextWithBlockBoundaries(item))
    .filter(Boolean)
    .join('\n'));
}

function readTextWithBlockBoundaries(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll('h1, h2, h3, h4, h5, h6, p, div, li, br')
    .forEach((block) => block.append(' '));
  return normalizeWhitespace(clone.textContent ?? '');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
