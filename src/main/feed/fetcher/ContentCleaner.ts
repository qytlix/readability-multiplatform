import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import createDOMPurify from 'dompurify';
import type { CleanResult } from '../../../shared/contracts/content.types';
import { hydrateArcStructuredContent } from './ArcStructuredContent';
import {
  removeSourceDecorativeGraphics,
  removeUntranslatableIcons,
} from './ContentGraphics';

export const CONTENT_CLEANER_VERSION = 6;

/** A stable distinction for a successful response with no extractable article. */
export class ContentExtractionError extends Error {
  override readonly name = 'ContentExtractionError';

  constructor() {
    super('Readability could not extract content');
  }
}

export class ContentCleaner {
  /**
   * Clean HTML using Mozilla Readability and DOMPurify sanitization.
   *
   * Using DOMPurify with JSDOM provides robust XSS protection against:
   * - Script tags and event handlers (onclick, onload, etc.)
   * - javascript: URLs in href/src attributes
   * - SVG handlers and HTML entities-based attacks
   * - Other XSS vectors that regex-based cleaning would miss
   */
  clean(html: string, baseUrl: string): CleanResult {
    const dom = new JSDOM(html, { url: baseUrl });
    hydrateArcStructuredContent(dom.window.document, baseUrl);
    removePublisherChrome(dom.window.document);
    removeCssHiddenElements(dom.window.document);
    protectMeaningfulArticleFigures(dom.window.document);
    removeSourceDecorativeGraphics(dom.window.document.body);
    const reader = new Readability(dom.window.document);
    const result = reader.parse();

    if (!result) {
      throw new ContentExtractionError();
    }

    return {
      title: result.title,
      byline: result.byline ?? undefined,
      content: sanitizeReaderContent(
        dom,
        result.content,
        baseUrl,
        result.byline ?? undefined,
      ),
      documentBaseURL: baseUrl,
    };
  }

  /**
   * Feed entry HTML is already scoped to a single item. Sanitize it directly
   * instead of applying Readability's document-length heuristics again.
   */
  cleanFeedContent(
    html: string,
    baseUrl: string,
    title: string,
    byline?: string,
  ): CleanResult {
    const dom = new JSDOM(
      '<html><head></head><body><article></article></body></html>',
      { url: baseUrl },
    );
    const article = dom.window.document.querySelector('article');
    if (!article) {
      throw new Error('Feed content could not be prepared');
    }
    article.innerHTML = html;
    removePublisherChrome(article);
    removeCssHiddenElements(dom.window.document);
    removeSourceDecorativeGraphics(article);

    const content = sanitizeReaderContent(dom, article.innerHTML, baseUrl, byline);
    const text = JSDOM.fragment(content).textContent?.replace(/\s+/g, ' ').trim();
    if (!text && !/<(?:img|video|audio|iframe)\b/i.test(content)) {
      throw new Error('Feed content is empty after sanitization');
    }

    return {
      title,
      byline,
      content,
      documentBaseURL: baseUrl,
    };
  }

  cleanStoredHtml(html: string): string {
    const dom = new JSDOM(`<body>${html}</body>`);
    const body = dom.window.document.body;
    removePublisherChrome(body);
    removeReaderAuthorBlocks(body);
    removeReaderBoilerplate(body);
    removeUntranslatableIcons(body);
    return body.innerHTML;
  }
}

function sanitizeReaderContent(
  dom: JSDOM,
  html: string,
  baseUrl: string,
  readabilityByline?: string,
): string {
  // JSDOM.fragment creates a DocumentFragment from the HTML string, which
  // DOMPurify sanitizes while preserving the Reader DOM structure.
  const purify = createDOMPurify(dom.window as any);
  const fragment = JSDOM.fragment(html);
  const sanitized = purify.sanitize(fragment);

  const container = dom.window.document.createElement('div');
  container.innerHTML = sanitized;
  removePublisherChrome(container);
  removeReaderProtectionClasses(container);
  normalizeReaderImages(container, baseUrl);
  normalizeReaderMedia(container, baseUrl);
  removeReaderAuthorBlocks(container, readabilityByline);
  removeReaderBoilerplate(container);
  removeUntranslatableIcons(container);
  return container.innerHTML;
}

/**
 * Readability can fall back to a common ancestor when a publisher wraps its
 * site header, navigation, and article in the same container. Remove only the
 * semantic chrome outside the strongest article/main root so article-local
 * headers and navigation remain available to the extractor.
 */
function removePublisherChrome(root: ParentNode): void {
  const readingRoot = findPrimaryReadingRoot(root);
  if (!readingRoot) return;

  for (const element of root.querySelectorAll(
    'header, nav, footer, [role="banner"], [role="navigation"], [role="contentinfo"]',
  )) {
    if (
      element === readingRoot
      || element.contains(readingRoot)
      || readingRoot.contains(element)
    ) {
      continue;
    }
    element.remove();
  }
}

function findPrimaryReadingRoot(root: ParentNode): Element | null {
  const article = findLongestElement(root.querySelectorAll('article'));
  if (article) return article;
  return findLongestElement(root.querySelectorAll('main, [role="main"]'));
}

function findLongestElement(elements: NodeListOf<Element>): Element | null {
  let longest: Element | null = null;
  let longestTextLength = -1;

  for (const element of elements) {
    const textLength = element.textContent?.replace(/\s+/g, ' ').trim().length
      ?? 0;
    if (textLength > longestTextLength) {
      longest = element;
      longestTextLength = textLength;
    }
  }

  return longest;
}

/**
 * JSDOM does not load publisher stylesheets, so Readability cannot tell that a
 * class such as `hidden` maps to `display: none`. Remove those explicitly
 * hidden subtrees before Readability turns long machine payloads into scored
 * paragraphs.
 */
function removeCssHiddenElements(document: Document): void {
  for (const element of document.querySelectorAll('.hidden')) {
    if (element === document.documentElement || element === document.body) {
      continue;
    }
    element.remove();
  }
}

function protectMeaningfulArticleFigures(document: Document): void {
  for (const figure of document.querySelectorAll('article figure, main figure')) {
    const image = figure.querySelector('img');
    if (!image || !isMeaningfulImage(image)) continue;

    let current: Element | null = figure;
    while (current && current !== document.body) {
      current.classList.add('shale-reader-content');
      if (current.tagName === 'ARTICLE' || current.tagName === 'MAIN') break;
      current = current.parentElement;
    }
  }
}

function isMeaningfulImage(image: HTMLImageElement): boolean {
  if (image.getAttribute('alt')?.trim()) return true;
  const width = Number(image.getAttribute('width'));
  const height = Number(image.getAttribute('height'));
  return Number.isFinite(width)
    && Number.isFinite(height)
    && width > 64
    && height > 64;
}

function removeReaderProtectionClasses(container: HTMLDivElement): void {
  for (const element of container.querySelectorAll('.shale-reader-content')) {
    element.classList.remove('shale-reader-content');
    if (!element.getAttribute('class')?.trim()) element.removeAttribute('class');
  }
}

function normalizeReaderImages(
  container: HTMLDivElement,
  baseUrl: string,
): void {
  for (const image of container.querySelectorAll('img')) {
    const lazyCandidate = image.getAttribute('data-src')
      ?? image.getAttribute('data-original')
      ?? image.getAttribute('data-lazy-src');
    const sourceCandidate = image.getAttribute('src');
    const srcset = image.getAttribute('data-srcset')
      ?? image.getAttribute('srcset');
    const normalizedSrcset = srcset
      ? normalizeImageSrcset(srcset, baseUrl)
      : null;
    if (normalizedSrcset) image.setAttribute('srcset', normalizedSrcset);
    else image.removeAttribute('srcset');

    const resolvedLazyCandidate = lazyCandidate
      ? resolveSafeMediaUrl(lazyCandidate, baseUrl)
      : null;
    const resolvedSourceCandidate = (
      sourceCandidate
      && !isPlaceholderImageUrl(sourceCandidate, baseUrl)
    )
      ? resolveSafeMediaUrl(sourceCandidate, baseUrl)
      : null;
    const resolvedCandidate = resolvedLazyCandidate ?? resolvedSourceCandidate;
    if (resolvedCandidate) image.setAttribute('src', resolvedCandidate);
    else image.removeAttribute('src');

    if (!image.hasAttribute('src') && !image.hasAttribute('srcset')) {
      image.remove();
      continue;
    }

    image.removeAttribute('data-src');
    image.removeAttribute('data-original');
    image.removeAttribute('data-lazy-src');
    image.removeAttribute('data-srcset');
  }

  for (const source of container.querySelectorAll('picture source')) {
    const srcset = source.getAttribute('srcset')
      ?? source.getAttribute('data-srcset');
    if (srcset) {
      const normalized = normalizeImageSrcset(srcset, baseUrl);
      if (normalized) source.setAttribute('srcset', normalized);
      else source.removeAttribute('srcset');
    }
    source.removeAttribute('data-srcset');
  }
}

function isPlaceholderImageUrl(candidate: string, baseUrl: string): boolean {
  const resolved = resolveSafeMediaUrl(candidate, baseUrl);
  if (!resolved) return false;
  const pathname = new URL(resolved).pathname.toLocaleLowerCase();
  const filename = pathname.split('/').pop() ?? '';
  return /^(?:img|image)[-_]placeholder(?:[.@_-]|$)/.test(filename)
    || /^placeholder(?:[.@_-]|$)/.test(filename);
}

/**
 * Remove linked author cards from cleaned content. Author metadata is
 * already available in the Reader header, so inline author cards are
 * redundant and should not appear in the article body, markdown, or
 * translations.
 */
function removeReaderAuthorBlocks(
  container: HTMLElement,
  readabilityByline?: string,
): void {
  const normalizedByline = normalizeAuthorText(readabilityByline);

  for (const image of container.querySelectorAll('img')) {
    const avatarName = normalizeAuthorText(image.getAttribute('alt'));
    if (
      !avatarName
      || (
        normalizedByline
        && !normalizedByline.includes(avatarName)
        && !avatarName.includes(normalizedByline)
      )
    ) {
      continue;
    }

    const avatarLink = image.closest('a');
    if (!avatarLink) continue;

    let card: HTMLElement | null = avatarLink.parentElement;
    for (let depth = 0; card && card !== container && depth < 4; depth += 1) {
      const nameElement = findAuthorNameElement(card, avatarLink, avatarName);
      if (nameElement && (card.textContent?.trim().length ?? 0) <= 500) {
        card.remove();
        break;
      }
      card = card.parentElement;
    }
  }

  // Second pass: detect cards whose avatar image was already removed
  // by removeSourceDecorativeGraphics (e.g., Verge 36×36 avatar).
  // Look for paragraphs containing an author-like link and matching text.
  removeImagelessAuthorCards(container, normalizedByline);
}

/**
 * Find an element matching the author name inside a card. Supports
 * both publisher-provided author links and non-link name elements
 * (many publishers use <span> or other inline elements).
 */
function findAuthorNameElement(
  card: HTMLElement,
  avatarLink: HTMLAnchorElement,
  avatarName: string,
): Element | null {
  // First pass: look for a matching <a> element
  const anchor = Array.from(card.querySelectorAll('a')).find((link) => (
    link !== avatarLink
    && normalizeAuthorText(link.textContent) === avatarName
  ));
  if (anchor) return anchor;

  // Second pass: look for any non-link element whose trimmed text
  // exactly matches the author name (handles Verge-style <span> names)
  for (const element of card.querySelectorAll('span, div, strong, p, b, i, em')) {
    if (
      element.textContent
      && normalizeAuthorText(element.textContent) === avatarName
    ) {
      return element;
    }
  }

  return null;
}

/**
 * After removeSourceDecorativeGraphics removes small avatars (e.g. 36×36
 * Verge author images), the author card becomes a <p> with an empty anchor
 * followed by the author name in a non-link element. Detect and remove these
 * imageless cards so they do not reach the Reader.
 */
function removeImagelessAuthorCards(
  container: HTMLElement,
  normalizedByline: string,
): void {
  for (const paragraph of container.querySelectorAll('p')) {
    const text = normalizeAuthorText(paragraph.textContent ?? '');
    if (!text || text.length > 300) continue;

    // Case 1: Paragraph has an empty author link (img was stripped)
    // This catches the test fixture pattern where name+bio are in one <p>
    const emptyAuthorLink = Array.from(paragraph.querySelectorAll(':scope > a')).find(
      (link) => !normalizeAuthorText(link.textContent)
        && (link.getAttribute('href') ?? '').includes('/author'),
    );

    if (emptyAuthorLink) {
      // Verify it contains the byline (when available) or looks like a bio
      if (normalizedByline && text.includes(normalizedByline)) {
        const nextPara = paragraph.nextElementSibling;
        paragraph.remove();
        // Also remove next paragraph if it looks like continuation bio
        if (nextPara && nextPara.tagName === 'P') {
          const nextText = normalizeAuthorText(nextPara.textContent ?? '');
          if (nextText && nextText.length <= 300) {
            nextPara.remove();
          }
        }
        continue;
      }
    }

    // Case 2: Two adjacent short paragraphs where P1 contains byline
    // and P2 looks like a bio (real Verge page after Readability)
    if (normalizedByline && text.includes(normalizedByline)) {
      const nextPara = paragraph.nextElementSibling;
      if (nextPara && nextPara.tagName === 'P') {
        const nextText = normalizeAuthorText(nextPara.textContent ?? '');
        if (nextText && nextText.length <= 200 && looksLikeAuthorBio(nextText)) {
          nextPara.remove();
          paragraph.remove();
          continue;
        }
      }
    }
  }
}

function looksLikeAuthorBio(text: string): boolean {
  return (
    /^(is a|was a|covers|writes about|specializes in|previously)/i.test(text)
    || /(?:\bpreviously\b|\bformer\b)/i.test(text)
    || text.length < 80
  );
}

/**
 * Remove non-article boilerplate that publishers embed in or near the
 * extracted article body: comment sections, "Follow"/"Subscribe" CTAs,
 * and standalone author headshots at the end of content.
 */
function removeReaderBoilerplate(container: HTMLElement): void {
  removeCommentContainers(container);
  removeFollowCTAs(container);
}

function removeCommentContainers(container: HTMLElement): void {
  const candidates = container.querySelectorAll(
    '[id*="comment" i], [class*="comment" i], [id*="commenting" i], [class*="commenting" i]',
  );
  for (const element of candidates) {
    const tagName = element.tagName.toLowerCase();
    // Only remove structural containers, not inline elements mentioning comments
    if (
      tagName === 'section'
      || tagName === 'div'
      || tagName === 'aside'
      || tagName === 'article'
    ) {
      element.remove();
    }
  }
}

function removeFollowCTAs(container: HTMLElement): void {
  for (const p of container.querySelectorAll('p')) {
    const text = p.textContent?.trim() ?? '';
    if (!text || text.length >= 200) continue;

    // Detect "Follow topics and authors" style CTAs
    const isFollowPrompt = /follow topics and authors/i.test(text);
    if (!isFollowPrompt) continue;

    // Remove the prompt paragraph and the following list (usually author names)
    const next = p.nextElementSibling;
    if (next && (next.tagName === 'UL' || next.tagName === 'OL')) {
      p.remove();
      next.remove();
    }
  }
}

function normalizeAuthorText(value?: string | null): string {
  return value?.replace(/\s+/g, ' ').trim().toLocaleLowerCase() ?? '';
}

function normalizeImageSrcset(
  value: string,
  baseUrl: string,
): string | null {
  const candidates = value
    .split(',')
    .map((candidate) => {
      const [urlCandidate, descriptor, ...extra] = candidate.trim().split(/\s+/);
      if (
        !urlCandidate
        || extra.length > 0
        || (descriptor && !/^(?:\d+w|\d+(?:\.\d+)?x)$/.test(descriptor))
      ) {
        return null;
      }
      const resolved = resolveSafeMediaUrl(urlCandidate, baseUrl);
      return resolved
        ? `${resolved}${descriptor ? ` ${descriptor}` : ''}`
        : null;
    })
    .filter((candidate): candidate is string => Boolean(candidate));
  return candidates.length > 0 ? candidates.join(', ') : null;
}

function normalizeReaderMedia(
  container: HTMLDivElement,
  baseUrl: string,
): void {
  for (const media of container.querySelectorAll('video, audio')) {
    media.setAttribute('controls', '');
    media.setAttribute('preload', 'metadata');
    media.removeAttribute('autoplay');
    media.removeAttribute('crossorigin');
    normalizeMediaSource(media, baseUrl);

    if (media.tagName.toLowerCase() === 'video') {
      normalizeUrlAttribute(media, 'poster', baseUrl);
    }

    for (const source of media.querySelectorAll('source')) {
      source.removeAttribute('crossorigin');
      normalizeMediaSource(source, baseUrl);
    }
  }
}

function normalizeMediaSource(element: Element, baseUrl: string): void {
  const candidate = element.getAttribute('src')
    ?? element.getAttribute('data-src');
  if (!candidate) return;

  const resolved = resolveSafeMediaUrl(candidate, baseUrl);
  if (resolved) {
    element.setAttribute('src', resolved);
  } else {
    element.removeAttribute('src');
  }
  element.removeAttribute('data-src');
}

function normalizeUrlAttribute(
  element: Element,
  attribute: string,
  baseUrl: string,
): void {
  const candidate = element.getAttribute(attribute);
  if (!candidate) return;

  const resolved = resolveSafeMediaUrl(candidate, baseUrl);
  if (resolved) {
    element.setAttribute(attribute, resolved);
  } else {
    element.removeAttribute(attribute);
  }
}

function resolveSafeMediaUrl(candidate: string, baseUrl: string): string | null {
  try {
    const url = new URL(candidate.trim(), baseUrl);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
