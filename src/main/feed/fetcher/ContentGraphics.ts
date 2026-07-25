const ICON_NAME_PATTERN =
  /(?:^|[-_\s])(?:icon|emoji|glyph|pictogram|material-icons?|lucide|heroicons?|fa[brs]?)(?:$|[-_\s])/i;
const EMOJI_PATTERN =
  /(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)/gu;

export const MATH_ELEMENT_SELECTOR = [
  'math',
  '[data-tex]',
  '[data-latex]',
  '.katex',
  '.katex-display',
  '.MathJax',
  '.math',
  '.math-inline',
  '.math-display',
  '.equation',
  '.formula',
  '.latex',
].join(', ');

export function removeUntranslatableIcons(root: HTMLElement): void {
  const elements = Array.from(root.querySelectorAll('*'));
  for (const element of elements) {
    if (root.contains(element) && isDecorativeIcon(element)) {
      element.remove();
    }
  }

  stripVisualEmojiFromText(root);
}

/**
 * Readability can discard publisher classes before post-cleanup runs. Remove
 * source graphics whose own attributes identify them as decorative while
 * those semantic hints are still available.
 */
export function removeSourceDecorativeGraphics(root: HTMLElement): void {
  for (const graphic of root.querySelectorAll('img, svg')) {
    if (isDecorativeIcon(graphic)) graphic.remove();
  }
}

export function isMathElement(node: Element): boolean {
  if (node.matches(MATH_ELEMENT_SELECTOR)) return true;
  const imageAlt = node.tagName.toLowerCase() === 'img'
    ? node.getAttribute('alt')?.trim()
    : undefined;
  return imageAlt ? hasMathDelimiter(imageAlt) : false;
}

export function removeVisualEmoji(value: string): string {
  return value
    .replace(EMOJI_PATTERN, '')
    .replace(/\u200D|\uFE0E|\uFE0F/g, '');
}

function isDecorativeIcon(node: Element): boolean {
  if (isMathElement(node)) return false;
  if (node.getAttribute('aria-hidden')?.toLowerCase() === 'true') return true;

  const tagName = node.tagName.toLowerCase();
  const semanticName = [
    node.getAttribute('class'),
    node.getAttribute('id'),
    node.getAttribute('data-testid'),
    node.getAttribute('data-icon'),
    node.getAttribute('data-lucide'),
  ].filter(Boolean).join(' ');

  if (ICON_NAME_PATTERN.test(semanticName)) return true;
  if (tagName !== 'img' && tagName !== 'svg') return false;
  return isSmallGraphic(node);
}

function isSmallGraphic(node: Element): boolean {
  const dimensions = readGraphicDimensions(node);
  return dimensions !== undefined
    && dimensions.width > 0
    && dimensions.height > 0
    && dimensions.width <= 64
    && dimensions.height <= 64;
}

function readGraphicDimensions(
  node: Element,
): { width: number; height: number } | undefined {
  const width = readPixelValue(node.getAttribute('width'))
    ?? readStylePixelValue(node.getAttribute('style'), 'width');
  const height = readPixelValue(node.getAttribute('height'))
    ?? readStylePixelValue(node.getAttribute('style'), 'height');
  if (width !== undefined && height !== undefined) return { width, height };

  if (node.tagName.toLowerCase() !== 'svg') return undefined;
  const viewBox = node.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (
    !viewBox
    || viewBox.length !== 4
    || viewBox.some((value) => !Number.isFinite(value))
  ) {
    return undefined;
  }
  return { width: viewBox[2], height: viewBox[3] };
}

function readPixelValue(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(value);
  return match ? Number(match[1]) : undefined;
}

function readStylePixelValue(
  style: string | null,
  property: 'width' | 'height',
): number | undefined {
  if (!style) return undefined;
  const match = new RegExp(
    `(?:^|;)\\s*${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)\\s*px\\s*(?:;|$)`,
    'i',
  ).exec(style);
  return match ? Number(match[1]) : undefined;
}

function hasMathDelimiter(value: string): boolean {
  return (
    (value.startsWith('$') && value.endsWith('$'))
    || (value.startsWith('\\(') && value.endsWith('\\)'))
    || (value.startsWith('\\[') && value.endsWith('\\]'))
  );
}

function stripVisualEmojiFromText(root: HTMLElement): void {
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  const textNodes: Text[] = [];
  let current = walker.nextNode();

  while (current) {
    if (current.nodeType === 3) textNodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const textNode of textNodes) {
    if (textNode.parentElement?.closest(MATH_ELEMENT_SELECTOR)) continue;
    textNode.data = removeVisualEmoji(textNode.data);
  }
}
