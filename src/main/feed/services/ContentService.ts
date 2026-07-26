import { performance } from 'node:perf_hooks';
import type {
  CleanedContent,
  CleanResult,
  FetchResult,
} from '../../../shared/contracts/content.types';
import type { Entry } from '../../../shared/contracts/feed.types';
import { ContentFetcher } from '../fetcher/ContentFetcher';
import {
  CONTENT_CLEANER_VERSION,
  ContentCleaner,
} from '../fetcher/ContentCleaner';
import {
  MARKDOWN_CONVERTER_VERSION,
  MarkdownConverter,
} from '../fetcher/MarkdownConverter';
import { ContentStore, EntryStore } from '../stores';
import {
  CONTENT_PIPELINE_ERROR_CODES,
  elapsedContentMilliseconds,
  logContentPipelineFailure,
  type ContentOperationLogger,
  type ContentPipelineErrorCode,
  type ContentPipelineStage,
} from './ContentLogging';
import { ContentSegmenter } from './ContentSegmenter';

export class ContentService {
  private contentStore: ContentStore;
  private entryStore: EntryStore;
  private fetcher: ContentFetcher;
  private cleaner: ContentCleaner;
  private markdownConverter: MarkdownConverter;
  private segmenter: ContentSegmenter;

  constructor(
    contentStore: ContentStore,
    entryStore: EntryStore,
    fetcher?: ContentFetcher,
    cleaner?: ContentCleaner,
    markdownConverter?: MarkdownConverter,
    private readonly logger?: ContentOperationLogger,
    segmenter?: ContentSegmenter,
  ) {
    this.contentStore = contentStore;
    this.entryStore = entryStore;
    this.fetcher = fetcher ?? new ContentFetcher();
    this.cleaner = cleaner ?? new ContentCleaner();
    this.markdownConverter = markdownConverter ?? new MarkdownConverter();
    this.segmenter = segmenter ?? new ContentSegmenter();
  }

  /**
   * Get existing cleaned content for an entry.
   */
  async getContent(entryId: number): Promise<CleanedContent | undefined> {
    let content = this.contentStore.findByEntry(entryId);
    if (!content) return undefined;
    if (
      content.pipelineStatus === 'failed'
      && this.hasRenderableCachedContent(content)
    ) {
      // Failed refreshes created before this fix may have hidden an older,
      // successfully sanitized body. Repair that state lazily on first read.
      this.contentStore.updatePipelineStatus(entryId, 'success');
      content = {
        ...content,
        pipelineStatus: 'success',
        pipelineError: undefined,
      };
    }

    const markdownSource = this.contentStore.findMarkdownSource(entryId);
    if (!markdownSource) return content;

    const needsHtmlUpgrade =
      (markdownSource.readabilityVersion ?? 0) < CONTENT_CLEANER_VERSION;
    const cleanedHtml = needsHtmlUpgrade
      ? this.rebuildStoredHtml(markdownSource)
      : markdownSource.cleanedHtml;
    const needsMarkdownUpgrade = needsHtmlUpgrade
      || (markdownSource.markdownVersion ?? 0) < MARKDOWN_CONVERTER_VERSION;
    const markdown = needsMarkdownUpgrade
      ? this.markdownConverter.convert(cleanedHtml)
      : content.markdown;

    if (needsHtmlUpgrade) {
      const segmentedContent = this.segmenter.segment(cleanedHtml, {
        title: content.readerTitle,
        byline: content.readerByline,
      });
      this.contentStore.upsert({
        entryId,
        cleanedHtml,
        markdown,
        readabilityVersion: CONTENT_CLEANER_VERSION,
        markdownVersion: MARKDOWN_CONVERTER_VERSION,
        pipelineStatus: content.pipelineStatus,
        pipelineError: content.pipelineError,
        segmenterVersion: segmentedContent.segmenterVersion,
        sourceContentHash: segmentedContent.sourceContentHash,
        segments: segmentedContent.segments,
      });
      this.entryStore.updateContentHash(
        entryId,
        segmentedContent.sourceContentHash,
      );
      return {
        ...content,
        cleanedHtml,
        markdown,
        segmenterVersion: segmentedContent.segmenterVersion,
        sourceContentHash: segmentedContent.sourceContentHash,
        segments: segmentedContent.segments,
      };
    }

    if (needsMarkdownUpgrade) {
      this.contentStore.upsert({
        entryId,
        markdown,
        markdownVersion: MARKDOWN_CONVERTER_VERSION,
        pipelineStatus: content.pipelineStatus,
        pipelineError: content.pipelineError,
      });
      return { ...content, markdown };
    }

    return content;
  }

  private rebuildStoredHtml(
    source: NonNullable<ReturnType<ContentStore['findMarkdownSource']>>,
  ): string {
    if (source.rawHtml && source.baseUrl) {
      try {
        return this.cleaner.clean(source.rawHtml, source.baseUrl).content;
      } catch {
        // A publisher can change its page shell after a successful extraction.
        // Keep the last sanitized Reader HTML instead of making cached content
        // unreadable during a cleaner-version upgrade.
        return this.cleaner.cleanStoredHtml(source.cleanedHtml);
      }
    }
    return this.cleaner.cleanStoredHtml(source.cleanedHtml);
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
    let previousContent: CleanedContent | undefined;

    try {
      entry = this.entryStore.findById(entryId);
      previousContent = this.contentStore.findByEntry(entryId);
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
      let cleanResult: CleanResult | undefined;
      const fetchResult = await this.fetcher.fetch(
        entry.url,
        signal,
        (candidate) => {
          cleanResult = this.cleaner.clean(candidate.body, candidate.url);
        },
      );

      // Phase 2: Clean
      stage = 'persist';
      this.contentStore.updatePipelineStatus(entryId, 'cleaning');
      stage = 'clean';
      cleanResult ??= this.cleaner.clean(fetchResult.body, fetchResult.url);
      return this.persistCleanedContent(
        entry,
        fetchResult,
        cleanResult,
        (nextStage) => {
          stage = nextStage;
        },
      );
    } catch (error) {
      const failedStage = stage;
      const failedErrorCode = this.getErrorCodeForStage(failedStage);
      const message = error instanceof Error ? error.message : String(error);

      if (this.hasRenderableCachedContent(previousContent)) {
        this.contentStore.upsert({
          entryId,
          pipelineStatus: 'success',
        });
        return {
          ...previousContent,
          pipelineStatus: 'success',
          pipelineError: undefined,
        };
      }

      const fallbackHtml = this.entryStore.findFeedContentHtml(entryId)
        ?? this.buildSummaryFallback(entry.summary);
      if (fallbackHtml) {
        try {
          const fallbackResult: FetchResult = {
            url: entry.url,
            statusCode: 200,
            headers: {},
            body: fallbackHtml,
          };
          const fallbackCleanResult = this.cleaner.cleanFeedContent(
            fallbackHtml,
            entry.url,
            entry.title ?? 'Untitled article',
            entry.author,
          );
          return this.persistCleanedContent(
            entry,
            fallbackResult,
            fallbackCleanResult,
          );
        } catch {
          // Preserve the original page-fetch/extraction error below; it is the
          // more actionable failure when both primary and fallback inputs fail.
        }
      }

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

  private persistCleanedContent(
    entry: Entry,
    fetchResult: FetchResult,
    cleanResult: CleanResult,
    onStageChange?: (stage: 'convert' | 'persist') => void,
  ): CleanedContent {
    onStageChange?.('persist');
    this.contentStore.updatePipelineStatus(entry.id, 'converting');
    onStageChange?.('convert');
    const markdown = this.markdownConverter.convert(cleanResult.content);
    const readerTitle = entry.title ?? cleanResult.title;
    const readerByline = entry.author ?? cleanResult.byline;
    const segmentedContent = this.segmenter.segment(cleanResult.content, {
      title: readerTitle,
      byline: readerByline,
    });

    onStageChange?.('persist');
    this.contentStore.upsert({
      entryId: entry.id,
      html: fetchResult.body,
      sourceUrl: fetchResult.url,
      cleanedHtml: cleanResult.content,
      markdown,
      readabilityVersion: CONTENT_CLEANER_VERSION,
      markdownVersion: MARKDOWN_CONVERTER_VERSION,
      readabilityTitle: cleanResult.title,
      readabilityByline: cleanResult.byline,
      documentBaseURL: cleanResult.documentBaseURL,
      pipelineStatus: 'success',
      segmenterVersion: segmentedContent.segmenterVersion,
      sourceContentHash: segmentedContent.sourceContentHash,
      segments: segmentedContent.segments,
    });

    this.entryStore.createOrUpdate({
      feedId: entry.feedId,
      guid: entry.guid,
      contentHash: segmentedContent.sourceContentHash,
    });

    return {
      entryId: entry.id,
      sourceUrl: fetchResult.url,
      readerTitle,
      readerByline,
      html: fetchResult.body,
      cleanedHtml: cleanResult.content,
      markdown,
      readabilityTitle: cleanResult.title,
      readabilityByline: cleanResult.byline,
      pipelineStatus: 'success',
      segmenterVersion: segmentedContent.segmenterVersion,
      sourceContentHash: segmentedContent.sourceContentHash,
      segments: segmentedContent.segments,
    };
  }

  private hasRenderableCachedContent(
    content: CleanedContent | undefined,
  ): content is CleanedContent {
    return Boolean(
      content
      && content.cleanedHtml.trim().length > 0,
    );
  }

  private buildSummaryFallback(summary: string | undefined): string | undefined {
    if (!summary?.trim()) return undefined;
    return `<p>${escapeHtml(summary.trim())}</p>`;
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
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[character] ?? character,
  );
}
