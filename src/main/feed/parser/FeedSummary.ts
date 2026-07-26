import { JSDOM } from 'jsdom';

const BLOCK_ELEMENTS = [
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'td',
  'th',
  'tr',
  'ul',
].join(',');

/**
 * Feed summaries are list metadata, so normalize publisher-supplied HTML to
 * readable plain text before it crosses the parser/store boundary.
 */
export function normalizeFeedSummary(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;

  const fragment = JSDOM.fragment(value);
  for (const element of fragment.querySelectorAll(
    'script, style, template, noscript, svg',
  )) {
    element.remove();
  }

  const document = fragment.ownerDocument;
  for (const element of fragment.querySelectorAll(BLOCK_ELEMENTS)) {
    element.after(document.createTextNode(' '));
  }

  const summary = fragment.textContent?.replace(/\s+/g, ' ').trim();
  return summary || undefined;
}
