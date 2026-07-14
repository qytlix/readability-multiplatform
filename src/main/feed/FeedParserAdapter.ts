import type { ParsedFeed, ParsedEntry } from '../../shared/contracts/feed.types';
import Parser from 'rss-parser';

type FeedType = 'rss' | 'atom' | 'json';

/**
 * FeedParserAdapter — 封装 rss-parser，输出统一 ParsedFeed 结构。
 *
 * 输入 XML/JSON 字符串 + sourceUrl，输出 ParsedFeed。
 * 支持 RSS 2.0、Atom、JSON Feed 三种格式。
 */
export interface IFeedParserAdapter {
  parse(xml: string, sourceUrl: string): Promise<ParsedFeed>;
}

export class FeedParserAdapter implements IFeedParserAdapter {
  private parser: Parser;

  constructor() {
    this.parser = new Parser({
      customFields: {
        feed: ['feedUrl'],
        item: [
          'guid',
          ['dc:creator', 'creator'],
          ['content:encoded', 'content'],
        ],
      },
    });
  }

  /**
   * 解析 XML/JSON 字符串，返回统一 ParsedFeed。
   * 自动识别 RSS / Atom / JSON Feed 格式。
   */
  async parse(xml: string, sourceUrl: string): Promise<ParsedFeed> {
    const feedType = this.detectFeedType(xml);

    if (feedType === 'json') {
      return this.parseJsonFeed(xml, sourceUrl);
    }

    return this.parseXmlFeed(xml, sourceUrl);
  }

  /**
   * 检测 Feed 类型
   */
  private detectFeedType(xml: string): FeedType {
    const trimmed = xml.trim();

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return 'json';
    }

    if (trimmed.startsWith('<?xml') || trimmed.startsWith('<')) {
      // rss-parser 能自动区分 RSS 和 Atom
      return 'rss';
    }

    throw new Error('Unrecognized feed format: must be XML or JSON');
  }

  /**
   * 解析 RSS/Atom (由 rss-parser 处理)
   */
  private async parseXmlFeed(xml: string, sourceUrl: string): Promise<ParsedFeed> {
    let result: ParsedFeed;

    try {
      const parsed = await this.parser.parseString(xml);

      result = {
        title: parsed.title ?? undefined,
        siteUrl: parsed.link ?? undefined,
        feedUrl: sourceUrl,
        entries: [],
      };

      if (parsed.items) {
        result.entries = parsed.items.map((item: Record<string, unknown>) =>
          this.normalizeEntry(item, sourceUrl),
        );
      }
    } catch (error) {
      throw new Error(
        `Feed parse failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return result;
  }

  /**
   * 解析 JSON Feed (手动实现，rss-parser 支持有限)
   */
  private async parseJsonFeed(json: string, sourceUrl: string): Promise<ParsedFeed> {
    let data: Record<string, unknown>;

    try {
      data = JSON.parse(json);
    } catch {
      throw new Error('JSON Feed parse failed: invalid JSON');
    }

    const version = data.version as string | undefined;
    if (!version || !version.startsWith('https://jsonfeed.org/version/')) {
      throw new Error(
        `JSON Feed parse failed: unknown version "${version ?? 'undefined'}"`,
      );
    }

    const feed: ParsedFeed = {
      title: (data.title as string) ?? undefined,
      siteUrl: (data.home_page_url as string) ?? undefined,
      feedUrl: (data.feed_url as string) ?? sourceUrl,
      entries: [],
    };

    const items = data.items as Array<Record<string, unknown>> | undefined;
    if (items && Array.isArray(items)) {
      feed.entries = items.map((item) => {
        const entry: ParsedEntry = {
          guid: (item.id as string) ?? '',
          url: (item.url as string) ?? undefined,
          title: (item.title as string) ?? undefined,
          publishedAt: (item.date_published as string) ?? undefined,
          summary: (item.summary as string) ?? undefined,
          contentHtml: (item.content_html as string) ?? undefined,
        };

        // 处理 authors
        const authors = item.authors as Array<{ name?: string }> | undefined;
        if (authors && Array.isArray(authors) && authors.length > 0) {
          entry.author = authors[0].name;
        }

        return entry;
      });
    }

    return feed;
  }

  /**
   * 将 rss-parser 的 item 映射为统一 ParsedEntry
   */
  private normalizeEntry(
    item: Record<string, unknown>,
    sourceUrl: string,
  ): ParsedEntry {
    // GUID 优先级：guid > id(JSON Feed) > link > sourceUrl
    const guid = (item.guid ?? item.id ?? item.link ?? sourceUrl) as string;

    return {
      guid: guid ?? '',
      url: (item.link ?? item.url) as string | undefined,
      title: item.title as string | undefined,
      author: (item.creator ?? item.author) as string | undefined,
      publishedAt: (item.isoDate ?? item.pubDate) as string | undefined,
      summary: (item.summary ?? item.contentSnippet) as string | undefined,
      contentHtml: (item.content ?? item.content_html) as string | undefined,
    };
  }
}