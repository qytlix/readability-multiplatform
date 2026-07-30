import {
  CHAT_SELECTION_LIMITS,
  type ChatSelectionContext,
} from '../../../shared/contracts/chat.types';

const ARTICLE_CHAT_SELECTION_ROOT = [
  '[data-inline-translation-root]',
  '.translation-bilingual-content',
].join(', ');

const ARTICLE_CHAT_CONTEXT_BLOCK = [
  'p',
  'li',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'pre',
  'cite',
  'figcaption',
  'caption',
].join(', ');

export interface ArticleChatSelectionTarget {
  selection: ChatSelectionContext;
  rect: DOMRect;
}

export interface ArticleChatSelectionRequest {
  requestId: number;
  selection: ChatSelectionContext;
}

export function getArticleChatSelectionTarget(
  selection: Selection | null,
  container: HTMLElement,
  entryId: number,
): ArticleChatSelectionTarget | null {
  if (
    !selection
    || selection.rangeCount !== 1
    || selection.isCollapsed
    || !Number.isInteger(entryId)
    || entryId <= 0
  ) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const startElement = closestElement(range.startContainer);
  const endElement = closestElement(range.endContainer);
  if (
    !startElement
    || !endElement
    || !container.contains(startElement)
    || !container.contains(endElement)
  ) {
    return null;
  }

  const startRoot = startElement.closest<HTMLElement>(ARTICLE_CHAT_SELECTION_ROOT);
  const endRoot = endElement.closest<HTMLElement>(ARTICLE_CHAT_SELECTION_ROOT);
  if (
    !startRoot
    || startRoot !== endRoot
    || !container.contains(startRoot)
  ) {
    return null;
  }

  const text = normalizeSelectionText(selection.toString());
  if (!text || text.length > CHAT_SELECTION_LIMITS.textCharacters) return null;

  const contextBlock = startElement.closest<HTMLElement>(ARTICLE_CHAT_CONTEXT_BLOCK)
    ?? startElement.closest<HTMLElement>('.translation-bilingual-target')
    ?? startElement.closest<HTMLElement>('[data-segment-id]');
  const paragraphContext = normalizeSelectionText(contextBlock?.textContent ?? '');
  if (
    !paragraphContext
    || paragraphContext.length > CHAT_SELECTION_LIMITS.paragraphCharacters
  ) {
    return null;
  }

  const rawSegmentId = findSelectionSegmentId(startElement);
  const segmentId = rawSegmentId
    && rawSegmentId.length <= CHAT_SELECTION_LIMITS.segmentIdCharacters
    ? rawSegmentId
    : undefined;
  return {
    selection: {
      entryId,
      text,
      paragraphContext,
      ...(segmentId ? { segmentId } : {}),
    },
    rect: range.getBoundingClientRect(),
  };
}

function findSelectionSegmentId(startElement: Element): string | undefined {
  const containingSegment = startElement.closest<HTMLElement>('[data-segment-id]')
    ?.dataset.segmentId;
  if (containingSegment) return containingSegment;

  const translatedBlock = startElement.closest<HTMLElement>(
    '.translation-bilingual-target',
  );
  const sourceSegment = translatedBlock?.previousElementSibling;
  if (sourceSegment instanceof HTMLElement && sourceSegment.dataset.segmentId) {
    return sourceSegment.dataset.segmentId;
  }
  return undefined;
}

function closestElement(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

function normalizeSelectionText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
