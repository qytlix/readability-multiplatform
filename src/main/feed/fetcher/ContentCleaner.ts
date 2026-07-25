import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import createDOMPurify from 'dompurify';
import type { CleanResult } from '../../../shared/contracts/content.types';
import { hydrateArcStructuredContent } from './ArcStructuredContent';
import { removeUntranslatableIcons } from './ContentGraphics';

export const CONTENT_CLEANER_VERSION = 3;

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
    removeCssHiddenElements(dom.window.document);
    protectMeaningfulArticleFigures(dom.window.document);
    const reader = new Readability(dom.window.document);
    const result = reader.parse();

    if (!result) {
      throw new Error('Readability could not extract content');
    }

    // Create DOMPurify instance bound to the JSDOM window
    // JSDOM.fragment creates a DocumentFragment from the HTML string,
    // which DOMPurify sanitizes properly, preserving DOM structure
    // while removing all XSS vectors.
    const purify = createDOMPurify(dom.window as any);
    const fragment = JSDOM.fragment(result.content);
    const sanitized = purify.sanitize(fragment);

    // DOMPurify may wrap output in a container; serialize back to string
    const container = dom.window.document.createElement('div');
    container.innerHTML = sanitized;
    removeReaderProtectionClasses(container);
    normalizeReaderImages(container, baseUrl);
    normalizeReaderMedia(container, baseUrl);
    removeUntranslatableIcons(container);

    return {
      title: result.title,
      byline: result.byline ?? undefined,
      content: container.innerHTML,
      documentBaseURL: baseUrl,
    };
  }

  cleanStoredHtml(html: string): string {
    const dom = new JSDOM(`<body>${html}</body>`);
    const body = dom.window.document.body;
    removeUntranslatableIcons(body);
    return body.innerHTML;
  }
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
    const candidate = image.getAttribute('src')
      ?? image.getAttribute('data-src')
      ?? image.getAttribute('data-original')
      ?? image.getAttribute('data-lazy-src');
    if (candidate) {
      const resolved = resolveSafeMediaUrl(candidate, baseUrl);
      if (resolved) image.setAttribute('src', resolved);
      else image.removeAttribute('src');
    }

    const srcset = image.getAttribute('srcset')
      ?? image.getAttribute('data-srcset');
    if (srcset) {
      const normalized = normalizeImageSrcset(srcset, baseUrl);
      if (normalized) image.setAttribute('srcset', normalized);
      else image.removeAttribute('srcset');
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
