import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import createDOMPurify from 'dompurify';
import type { CleanResult } from '../../shared/contracts/content.types';

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

    return {
      title: result.title,
      byline: result.byline ?? undefined,
      content: container.innerHTML,
      documentBaseURL: baseUrl,
    };
  }
}
