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
      throw new Error('Readability could not extract content');
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
    normalizeReaderAuthorBlocks(body);
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
  normalizeReaderAuthorBlocks(container, readabilityByline);
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
 * Publisher styles are intentionally removed from cleaned content. Preserve a
 * small, stable semantic hook for compact author cards so avatar images do not
 * inherit the Reader's full-width article-image layout.
 */
function normalizeReaderAuthorBlocks(
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
      const nameLink = Array.from(card.querySelectorAll('a')).find((link) => (
        link !== avatarLink
        && normalizeAuthorText(link.textContent) === avatarName
      ));
      if (nameLink && (card.textContent?.trim().length ?? 0) <= 500) {
        const details = findDirectChildContaining(card, nameLink);
        card.classList.add('reader-author-card');
        avatarLink.classList.add('reader-author-avatar-link');
        image.classList.add('reader-author-avatar');
        nameLink.classList.add('reader-author-name');
        details?.classList.add('reader-author-details');
        for (const paragraph of details?.querySelectorAll('p') ?? []) {
          if (!paragraph.contains(nameLink) && paragraph.textContent?.trim()) {
            paragraph.classList.add('reader-author-bio');
          }
        }
        break;
      }
      card = card.parentElement;
    }
  }
}

function normalizeAuthorText(value?: string | null): string {
  return value?.replace(/\s+/g, ' ').trim().toLocaleLowerCase() ?? '';
}

function findDirectChildContaining(
  parent: HTMLElement,
  descendant: Element,
): HTMLElement | null {
  const directChild = Array.from(parent.children).find(
    (child) => child.contains(descendant),
  );
  return directChild ? directChild as HTMLElement : null;
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
