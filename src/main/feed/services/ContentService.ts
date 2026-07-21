import { performance } from 'node:perf_hooks';
import type { CleanedContent } from '../../../shared/contracts/content.types';
import { ContentFetcher } from '../fetcher/ContentFetcher';
import { ContentCleaner } from '../fetcher/ContentCleaner';
import { MarkdownConverter } from '../fetcher/MarkdownConverter';
import { ContentStore, EntryStore } from '../stores';
import {
  CONTENT_PIPELINE_ERROR_CODES,
  elapsedContentMilliseconds,
  logContentPipelineFailure,
  type ContentOperationLogger,
  type ContentPipelineErrorCode,
  type ContentPipelineStage,
} from './ContentLogging';

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
    private readonly logger?: ContentOperationLogger,
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
    const startedAt = performance.now();
    let stage: ContentPipelineStage = 'lookup';
    let entry: ReturnType<EntryStore['findById']>;

    try {
      entry = this.entryStore.findById(entryId);
    } catch (error) {
      this.logPipelineFailure(
        entryId,
        undefined,
        startedAt,
        stage,
        CONTENT_PIPELINE_ERROR_CODES.lookupFailed,
      );
      throw error;
    }

    if (!entry) {
      this.logPipelineFailure(
        entryId,
        undefined,
        startedAt,
        stage,
        CONTENT_PIPELINE_ERROR_CODES.entryNotFound,
      );
      return this.buildFailedResult(entryId, 'Entry not found');
    }

    stage = 'validate';
    if (!entry.url) {
      this.logPipelineFailure(
        entryId,
        entry.feedId,
        startedAt,
        stage,
        CONTENT_PIPELINE_ERROR_CODES.entryUrlMissing,
      );
      return this.buildFailedResult(entryId, 'Entry has no URL');
    }

    try {
      // Phase 1: Fetch
      stage = 'persist';
      this.contentStore.updatePipelineStatus(entryId, 'fetching');
      stage = 'fetch';
      const fetchResult = await this.fetcher.fetch(entry.url, signal);

      // Phase 2: Clean
      stage = 'persist';
      this.contentStore.updatePipelineStatus(entryId, 'cleaning');
      stage = 'clean';
      const cleanResult = this.cleaner.clean(
        fetchResult.body,
        fetchResult.url,
      );

      // Phase 3: Convert to Markdown
      stage = 'persist';
      this.contentStore.updatePipelineStatus(entryId, 'converting');
      stage = 'convert';
      const markdown = this.markdownConverter.convert(cleanResult.content);

      // Simple content hash for caching
      const sourceContentHash = this.hashString(fetchResult.body);

      // Persist
      stage = 'persist';
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
        html: fetchResult.body,
        cleanedHtml: cleanResult.content,
        markdown: markdown,
        readabilityTitle: cleanResult.title,
        readabilityByline: cleanResult.byline,
        pipelineStatus: 'success',
        segmenterVersion: 'v1',
        sourceContentHash,
      };
    } catch (error) {
      const failedStage = stage;
      const failedErrorCode = this.getErrorCodeForStage(failedStage);
      const message = error instanceof Error ? error.message : String(error);

      try {
        this.contentStore.upsert({
          entryId,
          pipelineStatus: 'failed',
          pipelineError: message,
        });
      } catch (persistError) {
        this.logPipelineFailure(
          entryId,
          entry.feedId,
          startedAt,
          'persist',
          CONTENT_PIPELINE_ERROR_CODES.persistFailed,
        );
        throw persistError;
      }

      this.logPipelineFailure(
        entryId,
        entry.feedId,
        startedAt,
        failedStage,
        failedErrorCode,
      );

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

  private logPipelineFailure(
    entryId: number,
    feedId: number | undefined,
    startedAt: number,
    stage: ContentPipelineStage,
    errorCode: ContentPipelineErrorCode,
  ): void {
    logContentPipelineFailure(this.logger, {
      entryId,
      ...(feedId === undefined ? {} : { feedId }),
      durationMs: elapsedContentMilliseconds(startedAt),
      success: false,
      stage,
      errorCode,
    });
  }

  private getErrorCodeForStage(
    stage: ContentPipelineStage,
  ): ContentPipelineErrorCode {
    switch (stage) {
      case 'lookup':
        return CONTENT_PIPELINE_ERROR_CODES.lookupFailed;
      case 'validate':
        return CONTENT_PIPELINE_ERROR_CODES.entryUrlMissing;
      case 'fetch':
        return CONTENT_PIPELINE_ERROR_CODES.fetchFailed;
      case 'clean':
        return CONTENT_PIPELINE_ERROR_CODES.cleanFailed;
      case 'convert':
        return CONTENT_PIPELINE_ERROR_CODES.convertFailed;
      case 'persist':
        return CONTENT_PIPELINE_ERROR_CODES.persistFailed;
    }
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
