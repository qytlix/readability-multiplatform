import type { CleanedContent, PipelineStatus } from '../../shared/contracts/content.types';
import { ContentStore } from './ContentStore';
import { ContentFetcher } from './ContentFetcher';
import { ContentCleaner } from './ContentCleaner';
import { MarkdownConverter } from './MarkdownConverter';
import { EntryStore } from './EntryStore';

export class ContentService {
  private contentStore: ContentStore;
  private entryStore: EntryStore;
  private fetcher: ContentFetcher;
  private cleaner: ContentCleaner;
  private markdownConverter: MarkdownConverter;

  constructor(
    contentStore: ContentStore,
    entryStore: EntryStore,
    fetcher?: ContentFetcher,
    cleaner?: ContentCleaner,
    markdownConverter?: MarkdownConverter,
  ) {
    this.contentStore = contentStore;
    this.entryStore = entryStore;
    this.fetcher = fetcher ?? new ContentFetcher();
    this.cleaner = cleaner ?? new ContentCleaner();
    this.markdownConverter = markdownConverter ?? new MarkdownConverter();
  }

  /**
   * Get existing cleaned content for an entry.
   */
  async getContent(entryId: number): Promise<CleanedContent | undefined> {
    return this.contentStore.findByEntry(entryId);
  }

  /**
   * Fetch article HTML, clean with Readability, convert to Markdown.
   * Updates pipeline status throughout the process.
   */
  async fetchAndClean(
    entryId: number,
    signal?: AbortSignal,
  ): Promise<CleanedContent> {
    const entry = this.entryStore.findById(entryId);
    if (!entry) {
      return this.buildFailedResult(entryId, 'Entry not found');
    }

    if (!entry.url) {
      return this.buildFailedResult(entryId, 'Entry has no URL');
    }

    try {
      // Phase 1: Fetch
      this.contentStore.updatePipelineStatus(entryId, 'fetching');
      const fetchResult = await this.fetcher.fetch(entry.url, signal);

      // Phase 2: Clean
      this.contentStore.updatePipelineStatus(entryId, 'cleaning');
      const cleanResult = this.cleaner.clean(
        fetchResult.body,
        fetchResult.url,
      );

      // Phase 3: Convert to Markdown
      this.contentStore.updatePipelineStatus(entryId, 'converting');
      const markdown = this.markdownConverter.convert(cleanResult.content);

      // Simple content hash for caching
      const sourceContentHash = this.hashString(fetchResult.body);

      // Persist
      this.contentStore.upsert({
        entryId,
        html: fetchResult.body,
        sourceUrl: fetchResult.url,
        cleanedHtml: cleanResult.content,
        markdown: markdown,
        readabilityTitle: cleanResult.title,
        readabilityByline: cleanResult.byline,
        documentBaseURL: cleanResult.documentBaseURL,
        pipelineStatus: 'success',
        segmenterVersion: 'v1',
        sourceContentHash,
      });

      // Update entry contentHash
      this.entryStore.createOrUpdate({
        feedId: entry.feedId,
        guid: entry.guid,
        contentHash: sourceContentHash,
      });

      return {
        entryId,
        sourceUrl: fetchResult.url,
        cleanedHtml: cleanResult.content,
        markdown: markdown,
        readabilityTitle: cleanResult.title,
        readabilityByline: cleanResult.byline,
        pipelineStatus: 'success',
        segmenterVersion: 'v1',
        sourceContentHash,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.contentStore.upsert({
        entryId,
        pipelineStatus: 'failed',
        pipelineError: message,
      });

      return this.buildFailedResult(entryId, message);
    }
  }

  private buildFailedResult(
    entryId: number,
    error: string,
  ): CleanedContent {
    return {
      entryId,
      sourceUrl: '',
      cleanedHtml: '',
      markdown: '',
      pipelineStatus: 'failed',
      pipelineError: error,
    };
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }
}