import { FeedStore } from '../stores';
import { createFeedError } from '../../../shared/errors/feed.errors';

export interface OPMLOutline {
  title?: string;
  text?: string;
  xmlUrl?: string;
  htmlUrl?: string;
  type?: string;
  children?: OPMLOutline[];
}

export interface OPMLImportResult {
  successCount: number;
  skipCount: number;
  failures: Array<{ title?: string; xmlUrl?: string; error: string }>;
  totalFound: number;
}

/**
 * Parse OPML XML content and extract feed outlines.
 */
function parseOPML(xml: string): OPMLOutline[] {
  // Simple XML parsing without external dependency
  const outlines: OPMLOutline[] = [];

  // Extract <body> content
  const bodyMatch = xml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) {
    throw createFeedError('OPML_INVALID', 'OPML file is missing <body> element', false);
  }

  const bodyContent = bodyMatch[1];

  // Parse nested outline elements recursively
  function parseOutlines(html: string, depth = 0): OPMLOutline[] {
    if (depth > 20) return []; // Prevent stack overflow on malformed input
    const result: OPMLOutline[] = [];

    // Combined regex matches both self-closing and container outlines in order
    const combinedRegex = /<outline\b([^>]*?)(\/>|>([\s\S]*?)<\/outline>)/gi;
    let match: RegExpExecArray | null;
    while ((match = combinedRegex.exec(html)) !== null) {
      const attrs = match[1];
      const isSelfClosing = match[2] === '/>';
      const innerHtml = isSelfClosing ? '' : match[3];

      const outline = parseAttributes(attrs);

      if (!isSelfClosing && innerHtml.trim()) {
        const children = parseOutlines(innerHtml, depth + 1);
        if (children.length > 0) {
          outline.children = children;
        }
      }

      if (outline.xmlUrl || (outline.children && outline.children.length > 0)) {
        result.push(outline);
      }
    }

    return result;
  }

  return parseOutlines(bodyContent);
}

function parseAttributes(attrString: string): OPMLOutline {
  const attrs: Record<string, string> = {};
  const attrRegex = /(\w+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrString)) !== null) {
    attrs[match[1].toLowerCase()] = match[2];
  }

  return {
    title: attrs.title || attrs.text,
    text: attrs.text,
    xmlUrl: attrs.xmlurl,
    htmlUrl: attrs.htmlurl,
    type: attrs.type,
  };
}

/**
 * Flatten nested outline tree into a list of feeds (leaf nodes with xmlUrl).
 */
function flattenOutlines(outlines: OPMLOutline[]): Array<{ title?: string; xmlUrl: string; htmlUrl?: string }> {
  const feeds: Array<{ title?: string; xmlUrl: string; htmlUrl?: string }> = [];

  function walk(list: OPMLOutline[]): void {
    for (const outline of list) {
      if (outline.xmlUrl) {
        feeds.push({
          title: outline.title || outline.text,
          xmlUrl: outline.xmlUrl,
          htmlUrl: outline.htmlUrl,
        });
      }
      if (outline.children) {
        walk(outline.children);
      }
    }
  }

  walk(outlines);
  return feeds;
}

export class OPMLImportService {
  private feedStore: FeedStore;

  constructor(feedStore: FeedStore) {
    this.feedStore = feedStore;
  }

  /**
   * Import feeds from an OPML file's content.
   *
   * @param xml - Raw OPML XML string
   * @param mode - 'merge' appends new feeds, skips duplicates
   *               'replace' removes feeds not in OPML, adds new ones
   */
  async importFromContent(xml: string, mode: 'merge' | 'replace'): Promise<OPMLImportResult> {
    // Validate basic XML structure
    if (!xml.trim().startsWith('<?xml') && !xml.trim().startsWith('<opml')) {
      throw createFeedError('OPML_INVALID', 'File does not appear to be valid OPML XML', false);
    }

    const opmlTagMatch = xml.match(/<opml[^>]*>/i);
    if (!opmlTagMatch) {
      throw createFeedError('OPML_INVALID', 'Missing <opml> root element', false);
    }

    let outlines: OPMLOutline[];
    try {
      outlines = parseOPML(xml);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createFeedError(
        'OPML_PARSE_FAILED',
        error instanceof Error ? error.message : 'Failed to parse OPML structure',
        false,
      );
    }

    const feedsToImport = flattenOutlines(outlines);

    if (feedsToImport.length === 0) {
      return {
        successCount: 0,
        skipCount: 0,
        failures: [{ error: 'No feed URLs found in OPML file' }],
        totalFound: 0,
      };
    }

    if (mode === 'replace') {
      return this.importReplace(feedsToImport);
    }

    return this.importMerge(feedsToImport);
  }

  /**
   * Merge mode: add new feeds, skip duplicates.
   */
  private importMerge(
    feedsToImport: Array<{ title?: string; xmlUrl: string; htmlUrl?: string }>,
  ): OPMLImportResult {
    const result: OPMLImportResult = {
      successCount: 0,
      skipCount: 0,
      failures: [],
      totalFound: feedsToImport.length,
    };

    const existingUrls = new Set(
      this.feedStore.findAll().map((f) => f.feedURL.toLowerCase()),
    );

    for (const feed of feedsToImport) {
      try {
        if (!feed.xmlUrl) {
          result.skipCount++;
          continue;
        }

        if (existingUrls.has(feed.xmlUrl.toLowerCase())) {
          result.skipCount++;
          continue;
        }

        // Validate URL format
        try {
          new URL(feed.xmlUrl);
          if (feed.xmlUrl.startsWith('http://') || feed.xmlUrl.startsWith('https://')) {
            // Valid, proceed
          } else {
            result.failures.push({
              title: feed.title,
              xmlUrl: feed.xmlUrl,
              error: 'Invalid protocol (must be http or https)',
            });
            continue;
          }
        } catch {
          result.failures.push({
            title: feed.title,
            xmlUrl: feed.xmlUrl,
            error: 'Invalid URL format',
          });
          continue;
        }

        // Create feed record (without syncing)
        this.feedStore.create({
          title: feed.title,
          feedURL: feed.xmlUrl,
          siteURL: feed.htmlUrl,
        });

        result.successCount++;
        existingUrls.add(feed.xmlUrl.toLowerCase());
      } catch (error) {
        result.failures.push({
          title: feed.title,
          xmlUrl: feed.xmlUrl,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  /**
   * Replace mode: add all OPML feeds, then remove feeds not in OPML.
   * Uses FeedStore.deleteAllExcept for efficient batch deletion.
   */
  private importReplace(
    feedsToImport: Array<{ title?: string; xmlUrl: string; htmlUrl?: string }>,
  ): OPMLImportResult {
    const result: OPMLImportResult = {
      successCount: 0,
      skipCount: 0,
      failures: [],
      totalFound: feedsToImport.length,
    };

    const newUrls = new Set(feedsToImport.map((f) => f.xmlUrl.toLowerCase()));

    // Add all OPML feeds
    for (const feed of feedsToImport) {
      try {
        if (!feed.xmlUrl) {
          result.skipCount++;
          continue;
        }

        // Validate URL
        new URL(feed.xmlUrl);

        const existing = this.feedStore.findByUrl(feed.xmlUrl);
        if (!existing) {
          this.feedStore.create({
            title: feed.title,
            feedURL: feed.xmlUrl,
            siteURL: feed.htmlUrl,
          });
        }
        result.successCount++;
      } catch (error) {
        result.failures.push({
          title: feed.title,
          xmlUrl: feed.xmlUrl,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Remove feeds not in OPML
    this.feedStore.deleteAllExcept(newUrls);

    return result;
  }
}