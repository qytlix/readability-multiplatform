import type {
  AnnotationColor,
  CreateAnnotationRequest,
  EntryAnnotation,
} from '../../../shared/contracts/annotation.types';

const CONTEXT_LENGTH = 64;

export interface ResolvedAnnotationRange {
  annotation: EntryAnnotation;
  startOffset: number;
  endOffset: number;
}

export function createAnnotationRequestFromSelection(
  selection: Selection | null,
  root: HTMLElement,
  entryId: number,
  color: AnnotationColor,
): CreateAnnotationRequest | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer)
    || !root.contains(range.endContainer)
  ) {
    return null;
  }

  const fullText = root.textContent ?? '';
  const startOffset = getBoundaryTextOffset(root, range.startContainer, range.startOffset);
  const endOffset = getBoundaryTextOffset(root, range.endContainer, range.endOffset);
  if (endOffset <= startOffset) return null;
  const selectedText = fullText.slice(startOffset, endOffset);
  if (!selectedText.trim()) return null;

  return {
    entryId,
    startOffset,
    endOffset,
    selectedText,
    prefixText: fullText.slice(
      Math.max(0, startOffset - CONTEXT_LENGTH),
      startOffset,
    ),
    suffixText: fullText.slice(
      endOffset,
      Math.min(fullText.length, endOffset + CONTEXT_LENGTH),
    ),
    color,
  };
}

export function applyAnnotationHighlights(
  sourceHtml: string,
  annotations: EntryAnnotation[],
  ownerDocument: Document = document,
): string {
  const template = ownerDocument.createElement('template');
  template.innerHTML = sourceHtml;
  const fullText = template.content.textContent ?? '';
  const resolved = annotations
    .map((annotation) => resolveAnnotationRange(annotation, fullText))
    .filter((range): range is ResolvedAnnotationRange => range !== null)
    .sort((left, right) => right.startOffset - left.startOffset);

  for (const range of resolved) {
    wrapTextRange(template.content, range, ownerDocument);
  }
  return template.innerHTML;
}

export function resolveAnnotationRange(
  annotation: EntryAnnotation,
  fullText: string,
): ResolvedAnnotationRange | null {
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
    const candidateScore = scoreContext(annotation, fullText, candidate);
    const bestScore = scoreContext(annotation, fullText, best);
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

export function rangesOverlap(
  startOffset: number,
  endOffset: number,
  annotations: EntryAnnotation[],
): boolean {
  return annotations.some((annotation) => (
    startOffset < annotation.endOffset && endOffset > annotation.startOffset
  ));
}

function getBoundaryTextOffset(
  root: HTMLElement,
  container: Node,
  offset: number,
): number {
  const prefixRange = root.ownerDocument.createRange();
  prefixRange.selectNodeContents(root);
  prefixRange.setEnd(container, offset);
  return prefixRange.cloneContents().textContent?.length ?? 0;
}

function scoreContext(
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

function wrapTextRange(
  root: DocumentFragment,
  range: ResolvedAnnotationRange,
  ownerDocument: Document,
): void {
  const nodeFilter = ownerDocument.defaultView?.NodeFilter ?? NodeFilter;
  const walker = ownerDocument.createTreeWalker(
    root,
    nodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        return parent?.closest('script, style, mark[data-annotation-id]')
          ? nodeFilter.FILTER_REJECT
          : nodeFilter.FILTER_ACCEPT;
      },
    },
  );
  const textNodes: Array<{ node: Text; startOffset: number; endOffset: number }> = [];
  let textOffset = 0;
  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const endOffset = textOffset + textNode.data.length;
    textNodes.push({ node: textNode, startOffset: textOffset, endOffset });
    textOffset = endOffset;
    current = walker.nextNode();
  }

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
    const mark = ownerDocument.createElement('mark');
    mark.className = 'annotation-highlight';
    mark.dataset.annotationId = String(range.annotation.id);
    mark.dataset.annotationColor = range.annotation.color;
    mark.tabIndex = 0;
    selectedNode.parentNode?.insertBefore(mark, selectedNode);
    mark.append(selectedNode);
  }
}
