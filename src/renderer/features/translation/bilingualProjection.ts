import type { TranslationSegment } from '../../../shared/contracts/translation.types';

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

interface ProjectionState {
  showPendingIndicators: boolean;
}

/**
 * Projects translations onto a sanitized Reader HTML tree.
 *
 * The Reader tree remains the layout source of truth so non-translatable
 * content such as figures, standalone images, tables, and technical code
 * blocks stays in its original position. Only translated text blocks are
 * inserted.
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
    if (
      segment.status === 'succeeded'
      && segment.translatedHtml
      && segment.translatedHtml !== segment.sourceHtml
    ) {
      insertTranslatedElement(sourceElement, createTranslatedElement(sourceElement, segment));
    } else if (state.showPendingIndicators && segment.status === 'pending') {
      appendPendingIndicator(sourceElement);
    } else if (segment.status === 'failed') {
      appendUntranslatedIndicator(sourceElement);
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
      && toSegmentType(candidate) === segment.sourceType
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

  target.innerHTML = getTranslatedContent(sourceElement, segment.translatedHtml ?? '');
  // The original media is already present in the Reader skeleton. Avoid
  // duplicating inline images that were part of a translatable paragraph.
  target.querySelectorAll('img, picture, video, audio, iframe, object, embed, svg, canvas')
    .forEach((element) => element.remove());
  return target;
}

function getTranslatedContent(sourceElement: HTMLElement, translatedHtml: string): string {
  if (sourceElement.tagName.toLowerCase() !== 'li') return translatedHtml;
  const template = sourceElement.ownerDocument.createElement('template');
  template.innerHTML = translatedHtml;
  const translatedRoot = template.content.firstElementChild;
  return translatedRoot?.tagName.toLowerCase() === 'li'
    ? translatedRoot.innerHTML
    : translatedHtml;
}

function insertTranslatedElement(
  sourceElement: HTMLElement,
  translatedElement: HTMLElement,
): void {
  if (sourceElement.tagName.toLowerCase() !== 'li') {
    sourceElement.insertAdjacentElement('afterend', translatedElement);
    return;
  }
  const nestedList = sourceElement.querySelector(':scope > ul, :scope > ol');
  if (nestedList) {
    nestedList.insertAdjacentElement('beforebegin', translatedElement);
    return;
  }
  sourceElement.append(translatedElement);
}

function appendPendingIndicator(sourceElement: HTMLElement): void {
  const indicator = sourceElement.ownerDocument.createElement('span');
  indicator.className = 'translation-segment-spinner';
  indicator.setAttribute('role', 'img');
  indicator.setAttribute('aria-label', 'Translating this segment');

  const tagName = sourceElement.tagName.toLowerCase();
  if (tagName === 'li') {
    const nestedList = sourceElement.querySelector(':scope > ul, :scope > ol');
    if (nestedList) nestedList.insertAdjacentElement('beforebegin', indicator);
    else sourceElement.append(indicator);
    return;
  }
  if (tagName === 'blockquote') {
    (sourceElement.querySelector(':scope > p:last-of-type, :scope > cite:last-of-type')
      ?? sourceElement).append(indicator);
    return;
  }
  sourceElement.append(indicator);
}

function appendUntranslatedIndicator(sourceElement: HTMLElement): void {
  const indicator = sourceElement.ownerDocument.createElement('span');
  indicator.className = 'translation-segment-untranslated';
  indicator.setAttribute('role', 'status');
  indicator.setAttribute('aria-label', 'Translation unavailable for this segment');
  indicator.textContent = 'Untranslated';

  const tagName = sourceElement.tagName.toLowerCase();
  if (tagName === 'li') {
    const nestedList = sourceElement.querySelector(':scope > ul, :scope > ol');
    if (nestedList) nestedList.insertAdjacentElement('beforebegin', indicator);
    else sourceElement.append(indicator);
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
  const type = toSegmentType(element);
  if (type === 'list') return false;
  if (type === 'blockquote') {
    if (element.tagName.toLowerCase() !== 'blockquote') return false;
    return Boolean(element.querySelector(':scope > p, :scope > cite'));
  }
  if (element.parentElement?.closest('li, blockquote, ul, ol')) return true;
  return element.tagName.toLowerCase() === 'p' && Boolean(element.closest('figure'));
}

function toSegmentType(element: HTMLElement): TranslationSegment['sourceType'] | undefined {
  const normalizedTag = element.tagName.toLowerCase();
  if (/^h[1-6]$/.test(normalizedTag)) return 'heading';
  if (
    normalizedTag === 'blockquote'
    || ((normalizedTag === 'p' || normalizedTag === 'cite')
      && element.parentElement?.tagName.toLowerCase() === 'blockquote')
  ) {
    return 'blockquote';
  }
  if (normalizedTag === 'p') return 'paragraph';
  if (normalizedTag === 'li') return 'list';
  if (normalizedTag === 'pre') return 'preformatted';
  if (normalizedTag === 'figcaption' || normalizedTag === 'caption') return 'caption';
  return undefined;
}

function getSourceText(
  element: HTMLElement,
  type: TranslationSegment['sourceType'],
): string {
  if (type === 'blockquote') {
    if (element.tagName.toLowerCase() !== 'blockquote') {
      return normalizeWhitespace(element.textContent ?? '');
    }
    const blocks = Array.from(element.querySelectorAll(':scope > p, :scope > cite'))
      .map((block) => normalizeWhitespace(block.textContent ?? ''))
      .filter(Boolean)
      .join('\n');
    return normalizeWhitespace(blocks || (element.textContent ?? ''));
  }
  if (type !== 'list') return normalizeWhitespace(element.textContent ?? '');

  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('ul, ol').forEach((list) => list.remove());
  return readTextWithBlockBoundaries(clone);
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
