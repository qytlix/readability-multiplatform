type UnknownRecord = Record<string, unknown>;

const FUSION_METADATA_SELECTOR = 'script#fusion-metadata';
const GLOBAL_CONTENT_ASSIGNMENT = 'Fusion.globalContent';
const MIN_STRUCTURED_TEXT_LENGTH = 80;

/**
 * Arc Publishing pages can server-render only part of a live story while
 * embedding the complete ordered article model in Fusion metadata. Rebuild a
 * deterministic article DOM from that model before Readability runs.
 */
export function hydrateArcStructuredContent(
  document: Document,
  baseUrl: string,
): boolean {
  const scriptText = document.querySelector(FUSION_METADATA_SELECTOR)
    ?.textContent;
  if (!scriptText) return false;

  const globalContent = asRecord(
    extractAssignedJson(scriptText, GLOBAL_CONTENT_ASSIGNMENT),
  );
  const contentElements = asArray(globalContent?.content_elements);
  if (!globalContent || !contentElements?.length) return false;

  const article = document.createElement('article');
  article.className = 'shale-arc-structured-content';
  const renderedImageIds = new Set<string>();

  const promoImage = asRecord(
    asRecord(globalContent.promo_items)?.basic,
  );
  if (promoImage) {
    appendArcImage(
      document,
      article,
      promoImage,
      baseUrl,
      renderedImageIds,
    );
  }

  for (const contentElement of contentElements) {
    const record = asRecord(contentElement);
    if (record) {
      appendArcElement(
        document,
        article,
        record,
        baseUrl,
        renderedImageIds,
      );
    }
  }

  if (
    article.querySelectorAll('img').length === 0
    || normalizeText(article.textContent ?? '').length
      < MIN_STRUCTURED_TEXT_LENGTH
  ) {
    return false;
  }

  document.body.replaceChildren(article);
  return true;
}

function appendArcElement(
  document: Document,
  article: HTMLElement,
  element: UnknownRecord,
  baseUrl: string,
  renderedImageIds: Set<string>,
): void {
  switch (readString(element, 'type')) {
    case 'text': {
      const content = readString(element, 'content');
      if (!content || content.trimStart().startsWith('// Timestamp')) return;
      appendRichText(document, article, 'p', content);
      return;
    }
    case 'header': {
      const content = readString(element, 'content');
      if (!content) return;
      const requestedLevel = readNumber(element, 'level');
      const level = requestedLevel && requestedLevel >= 2 && requestedLevel <= 6
        ? requestedLevel
        : 2;
      appendRichText(
        document,
        article,
        `h${level}` as keyof HTMLElementTagNameMap,
        content,
      );
      return;
    }
    case 'image':
      appendArcImage(
        document,
        article,
        element,
        baseUrl,
        renderedImageIds,
      );
      return;
    case 'list':
      appendArcList(document, article, element);
      return;
    case 'divider':
      article.append(document.createElement('hr'));
      return;
    case 'oembed_response':
      appendArcEmbed(document, article, element);
      return;
    case 'interstitial_link':
      appendArcLink(document, article, element, baseUrl);
      return;
    default:
      return;
  }
}

function appendArcImage(
  document: Document,
  article: HTMLElement,
  imageRecord: UnknownRecord,
  baseUrl: string,
  renderedImageIds: Set<string>,
): void {
  if (readString(imageRecord, 'type') !== 'image') return;

  const imageId = readString(imageRecord, '_id');
  if (imageId && renderedImageIds.has(imageId)) return;

  const sourceUrl = resolveHttpUrl(
    readString(imageRecord, 'imageWebUrl')
      ?? readString(imageRecord, 'url'),
    baseUrl,
  );
  if (!sourceUrl) return;

  const figure = document.createElement('figure');
  const image = document.createElement('img');
  image.src = sourceUrl;
  image.loading = 'lazy';
  image.decoding = 'async';

  const caption = readString(imageRecord, 'caption');
  const subtitle = readString(imageRecord, 'subtitle');
  const altText = readString(imageRecord, 'alt_text')
    ?? readString(imageRecord, 'alt')
    ?? caption
    ?? subtitle
    ?? '';
  image.alt = stripHtml(altText);

  const width = readPositiveInteger(imageRecord, 'width');
  const height = readPositiveInteger(imageRecord, 'height');
  if (width) image.width = width;
  if (height) image.height = height;

  const srcset = normalizeSrcset(
    readString(imageRecord, 'imgSrcSet'),
    baseUrl,
  );
  if (srcset) {
    image.srcset = srcset;
    image.sizes = '(max-width: 760px) 100vw, 760px';
  }
  figure.append(image);

  const credit = readArcCredit(imageRecord);
  if (caption || credit) {
    const figcaption = document.createElement('figcaption');
    if (caption) {
      appendSanitizedSourceHtml(document, figcaption, caption);
    }
    if (credit) {
      const creditElement = document.createElement('span');
      creditElement.className = 'image-credit';
      creditElement.textContent = caption ? ` — ${credit}` : credit;
      figcaption.append(creditElement);
    }
    figure.append(figcaption);
  }

  article.append(figure);
  if (imageId) renderedImageIds.add(imageId);
}

function appendArcList(
  document: Document,
  article: HTMLElement,
  listRecord: UnknownRecord,
): void {
  const items = asArray(listRecord.items);
  if (!items?.length) return;

  const list = readString(listRecord, 'list_type') === 'ordered'
    ? document.createElement('ol')
    : document.createElement('ul');
  for (const item of items) {
    const content = readString(asRecord(item), 'content');
    if (!content) continue;
    const listItem = document.createElement('li');
    appendSanitizedSourceHtml(document, listItem, content);
    list.append(listItem);
  }
  if (list.children.length > 0) article.append(list);
}

function appendArcEmbed(
  document: Document,
  article: HTMLElement,
  embedRecord: UnknownRecord,
): void {
  const rawEmbed = asRecord(embedRecord.raw_oembed);
  const html = readString(rawEmbed, 'html');
  const url = readString(rawEmbed, 'url');
  if (html) {
    const container = document.createElement('div');
    container.className = 'embedded-post';
    appendSanitizedSourceHtml(document, container, html);
    if (normalizeText(container.textContent ?? '')) {
      article.append(container);
      return;
    }
  }
  if (url) {
    appendArcLink(document, article, {
      content: readString(rawEmbed, 'author_name') ?? url,
      url,
    }, url);
  }
}

function appendArcLink(
  document: Document,
  article: HTMLElement,
  linkRecord: UnknownRecord,
  baseUrl: string,
): void {
  const url = resolveHttpUrl(readString(linkRecord, 'url'), baseUrl);
  if (!url) return;

  const paragraph = document.createElement('p');
  const link = document.createElement('a');
  link.href = url;
  link.textContent = readString(linkRecord, 'content') ?? url;
  paragraph.append(link);
  article.append(paragraph);
}

function appendRichText<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  article: HTMLElement,
  tagName: K,
  html: string,
): void {
  const element = document.createElement(tagName);
  appendSanitizedSourceHtml(document, element, html);
  if (normalizeText(element.textContent ?? '')) article.append(element);
}

/**
 * The content is still untrusted publisher input. Remove active/resource
 * elements immediately; the completed Reader tree is sanitized by DOMPurify.
 */
function appendSanitizedSourceHtml(
  document: Document,
  target: HTMLElement,
  html: string,
): void {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const unsafeElement of template.content.querySelectorAll(
    'script, style, link, iframe, object, embed',
  )) {
    unsafeElement.remove();
  }
  target.append(template.content);
}

function readArcCredit(imageRecord: UnknownRecord): string | undefined {
  const by = asArray(asRecord(imageRecord.credits)?.by);
  if (!by) return undefined;

  const names = by
    .map((credit) => {
      const record = asRecord(credit);
      return readString(record, 'byline') ?? readString(record, 'name');
    })
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(', ') : undefined;
}

function extractAssignedJson(
  scriptText: string,
  assignmentName: string,
): unknown {
  const assignmentPattern = new RegExp(
    `${escapeRegExp(assignmentName)}\\s*=\\s*`,
  );
  const match = assignmentPattern.exec(scriptText);
  if (!match) return undefined;

  const start = match.index + match[0].length;
  const opening = scriptText[start];
  if (opening !== '{' && opening !== '[') return undefined;

  let depth = 0;
  let insideString = false;
  let escaped = false;
  for (let index = start; index < scriptText.length; index += 1) {
    const character = scriptText[index];
    if (insideString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        insideString = false;
      }
      continue;
    }

    if (character === '"') {
      insideString = true;
    } else if (character === '{' || character === '[') {
      depth += 1;
    } else if (character === '}' || character === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(scriptText.slice(start, index + 1)) as unknown;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function normalizeSrcset(
  value: string | undefined,
  baseUrl: string,
): string | undefined {
  if (!value) return undefined;

  const candidates = value
    .split(',')
    .map((candidate) => {
      const [urlCandidate, descriptor, ...extra] = candidate.trim().split(/\s+/);
      if (
        !urlCandidate
        || extra.length > 0
        || (descriptor && !/^(?:\d+w|\d+(?:\.\d+)?x)$/.test(descriptor))
      ) {
        return undefined;
      }
      const url = resolveHttpUrl(urlCandidate, baseUrl);
      return url ? `${url}${descriptor ? ` ${descriptor}` : ''}` : undefined;
    })
    .filter((candidate): candidate is string => Boolean(candidate));
  return candidates.length > 0 ? candidates.join(', ') : undefined;
}

function resolveHttpUrl(
  candidate: string | undefined,
  baseUrl: string,
): string | undefined {
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate, baseUrl);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function stripHtml(value: string): string {
  return normalizeText(value.replace(/<[^>]*>/g, ' '));
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function readString(
  record: UnknownRecord | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readNumber(
  record: UnknownRecord,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function readPositiveInteger(
  record: UnknownRecord,
  key: string,
): number | undefined {
  const value = readNumber(record, key);
  return value && Number.isInteger(value) && value > 0 ? value : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
