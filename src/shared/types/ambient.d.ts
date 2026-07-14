/* eslint-disable @typescript-eslint/no-explicit-any */

declare module 'rss-parser' {
  import type { ParsedFeed, ParsedEntry } from '../contracts/feed.types';

  interface ParserOptions<F, I> {
    customFields?: {
      feed?: string[];
      item?: Array<string | string[]>;
    };
    timeout?: number;
    headers?: Record<string, string>;
  }

  interface Output<F, I> {
    title?: string;
    link?: string;
    description?: string;
    feedUrl?: string;
    items?: I[];
    [key: string]: any;
  }

  class Parser<F = Record<string, any>, I = Record<string, any>> {
    constructor(options?: ParserOptions<F, I>);
    parseString(xml: string): Promise<Output<F, I>>;
    parseURL(url: string): Promise<Output<F, I>>;
  }

  export default Parser;
  export type { ParserOptions, Output };
}

declare module '@mozilla/readability' {
  interface ReadabilityOptions {
    debug?: boolean;
    maxElemsToParse?: number;
    nbTopCandidates?: number;
    charThreshold?: number;
    classesToPreserve?: string[];
    keepClasses?: boolean;
  }

  interface ParseResult {
    title: string;
    byline: string | null;
    dir: string | null;
    content: string;
    textContent: string;
    length: number;
    excerpt: string;
    siteName: string | null;
  }

  class Readability {
    constructor(document: Document, options?: ReadabilityOptions);
    parse(): ParseResult | null;
  }

  export { Readability, ReadabilityOptions, ParseResult };
}

declare module 'turndown' {
  interface TurndownOptions {
    headingStyle?: 'setext' | 'atx';
    hr?: string;
    bulletListMarker?: '-' | '*' | '+';
    codeBlockStyle?: 'fenced' | 'indented';
    fence?: '```' | '~~~';
    emDelimiter?: '_' | '*';
    strongDelimiter?: '**' | '__';
    linkStyle?: 'inlined' | 'referenced';
    linkReferenceStyle?: 'full' | 'collapsed' | 'shortcut';
    preformattedCode?: boolean;
  }

  interface TurndownRule {
    filter: string | string[] | ((node: HTMLElement, options: TurndownOptions) => boolean);
    replacement: (content: string, node: HTMLElement, options: TurndownOptions) => string;
  }

  class TurndownService {
    constructor(options?: TurndownOptions);
    addRule(key: string, rule: TurndownRule): this;
    keep(filter: string | string[]): this;
    remove(filter: string | string[]): this;
    use(plugin: (service: TurndownService) => void): this;
    turndown(html: string | Node): string;
  }

  export default TurndownService;
  export type { TurndownOptions, TurndownRule };
}