import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import createDOMPurify from 'dompurify';
import type { CleanResult } from '../../../shared/contracts/content.types';

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
    normalizeReaderMedia(container, baseUrl);

    return {
      title: result.title,
      byline: result.byline ?? undefined,
      content: container.innerHTML,
      documentBaseURL: baseUrl,
    };
  }
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
