import type { ContentSegment } from '../../../shared/contracts/content.types';
import {
  ARTICLE_CHAT_SYSTEM_INSTRUCTION,
  formatArticleMapContext,
  formatFullArticleContext,
  formatSelectionContext,
  formatTextAttachments,
  joinArticleChatReferenceParts,
  type TextAttachmentPromptSource,
} from '../provider/ArticleChatPrompt';
import type {
  ChatContextMode,
  ChatMessage,
  ChatSelectionContext,
} from '../../../shared/contracts/chat.types';
import {
  ArticleContextCacheStore,
  type ArticleContextCacheIdentity,
  type ArticleSegmentAnalysis,
} from '../stores/ArticleContextCacheStore';
import {
  assertArticleMapContextFits,
  chooseArticleContextMode,
  estimateChatTokens,
} from './ArticleContextBudget';
import { compressChatHistory } from './ChatHistoryCompression';

export const ARTICLE_CONTEXT_COMPRESSION_VERSION = 'article-context-v1';

export interface ArticleContextSource {
  entryId: number;
  title?: string;
  sourceUrl?: string;
  markdown: string;
  sourceContentHash: string;
  segments: ContentSegment[];
}

export interface ArticleSegmentAnalyzer {
  analyze(
    segment: ContentSegment,
    usage?: ArticleSegmentAnalysisUsage,
  ): Promise<string>;
}

export interface ArticleSegmentAnalysisUsage {
  attemptId: string;
  taskRunId: number;
  providerProfileId: number;
  model: string;
}

export interface PrepareArticleContextRequest {
  source: ArticleContextSource;
  history: readonly ChatMessage[];
  question: string;
  selection?: ChatSelectionContext;
  textAttachments: readonly TextAttachmentPromptSource[];
  analysisModelFamily: string;
  contextWindowTokens: number;
  responseReserveTokens: number;
  analysisUsage?: ArticleSegmentAnalysisUsage;
}

export interface PreparedArticleContext {
  mode: ChatContextMode;
  systemInstruction: string;
  articleReference: string;
  historyReference: string;
  estimatedPromptTokens: number;
  cacheHit: boolean;
  relatedSegmentIds: string[];
}

export class ArticleContextService {
  constructor(
    private readonly cacheStore: ArticleContextCacheStore,
    private readonly segmentAnalyzer: ArticleSegmentAnalyzer,
  ) {}

  async prepare(
    request: PrepareArticleContextRequest,
  ): Promise<PreparedArticleContext> {
    const identity: ArticleContextCacheIdentity = {
      entryId: request.source.entryId,
      sourceContentHash: request.source.sourceContentHash,
      promptVersion: 'article-chat-v1',
      compressionVersion: ARTICLE_CONTEXT_COMPRESSION_VERSION,
      analysisModelFamily: request.analysisModelFamily,
    };
    const cached = this.cacheStore.find(identity);
    const fullArticleContext = cached?.formattedContext
      ?? formatFullArticleContext({
        title: request.source.title,
        sourceUrl: request.source.sourceUrl,
        markdown: request.source.markdown,
        contentHash: request.source.sourceContentHash,
      });
    if (!cached) {
      this.cacheStore.save({
        ...identity,
        formattedContext: fullArticleContext,
        estimatedTokens: estimateChatTokens(fullArticleContext),
      });
    }

    const history = compressChatHistory(request.history);
    const selectionContext = formatSelectionContext(request.selection);
    const attachmentContext = formatTextAttachments(request.textAttachments);
    const decision = chooseArticleContextMode({
      contextWindowTokens: request.contextWindowTokens,
      responseReserveTokens: request.responseReserveTokens,
      systemInstruction: ARTICLE_CHAT_SYSTEM_INSTRUCTION,
      fullArticleContext,
      fullHistoryText: history.formattedFullHistory,
      compressedHistoryText: history.formattedCompressedHistory,
      currentQuestion: request.question,
      selectionText: selectionContext,
      currentAttachmentText: attachmentContext,
    });

    if (decision.mode !== 'article-map') {
      return {
        mode: decision.mode,
        systemInstruction: ARTICLE_CHAT_SYSTEM_INSTRUCTION,
        articleReference: joinArticleChatReferenceParts([
          fullArticleContext,
          selectionContext,
          attachmentContext,
        ]),
        historyReference: decision.mode === 'full'
          ? history.formattedFullHistory
          : history.formattedCompressedHistory,
        estimatedPromptTokens: decision.estimatedPromptTokens,
        cacheHit: Boolean(cached),
        relatedSegmentIds: [],
      };
    }

    const analyses = cached?.segmentAnalyses
      ?? await this.analyzeAllSegments(
        request.source.segments,
        request.analysisUsage,
      );
    const articleMap = cached?.articleMap ?? formatArticleMap(analyses);
    if (!cached?.articleMap || !cached.segmentAnalyses) {
      this.cacheStore.save({
        ...identity,
        formattedContext: fullArticleContext,
        articleMap,
        segmentAnalyses: analyses,
        estimatedTokens: estimateChatTokens(fullArticleContext),
      });
    }
    const relatedSegments = selectRelevantSegments(
      request.source.segments,
      request.question,
      request.selection?.segmentId,
    );
    const mapContext = formatArticleMapContext({
      title: request.source.title,
      sourceUrl: request.source.sourceUrl,
      contentHash: request.source.sourceContentHash,
    }, articleMap, relatedSegments.map(({ sourceText }) => sourceText));
    const articleReference = joinArticleChatReferenceParts([
      mapContext,
      selectionContext,
      attachmentContext,
    ]);
    const historyReference = history.formattedCompressedHistory;
    const estimatedPromptTokens = assertArticleMapContextFits(
      joinArticleChatReferenceParts([articleReference, historyReference]),
      {
        contextWindowTokens: request.contextWindowTokens,
        responseReserveTokens: request.responseReserveTokens,
        systemInstruction: ARTICLE_CHAT_SYSTEM_INSTRUCTION,
        currentQuestion: request.question,
      },
    );
    return {
      mode: 'article-map',
      systemInstruction: ARTICLE_CHAT_SYSTEM_INSTRUCTION,
      articleReference,
      historyReference,
      estimatedPromptTokens,
      cacheHit: Boolean(cached?.articleMap && cached.segmentAnalyses),
      relatedSegmentIds: relatedSegments.map(({ id }) => id),
    };
  }

  private async analyzeAllSegments(
    segments: readonly ContentSegment[],
    usage?: ArticleSegmentAnalysisUsage,
  ): Promise<ArticleSegmentAnalysis[]> {
    const analyses: ArticleSegmentAnalysis[] = [];
    for (const segment of segments) {
      analyses.push({
        segmentId: segment.id,
        orderIndex: segment.orderIndex,
        analysis: await this.segmentAnalyzer.analyze(segment, usage),
      });
    }
    return analyses;
  }
}

export function selectRelevantSegments(
  segments: readonly ContentSegment[],
  question: string,
  selectedSegmentId?: string,
): ContentSegment[] {
  if (segments.length === 0) return [];
  const terms = tokenize(question);
  const ranked = segments.map((segment) => ({
    segment,
    score: terms.reduce((score, term) => (
      score + (segment.sourceText.toLocaleLowerCase().includes(term) ? 1 : 0)
    ), segment.id === selectedSegmentId ? 100 : 0),
  })).sort((left, right) => (
    right.score - left.score
    || left.segment.orderIndex - right.segment.orderIndex
  ));
  const seeds = ranked.filter(({ score }) => score > 0).slice(0, 3);
  if (seeds.length === 0) seeds.push(ranked[0]);
  const orderIndexes = new Set<number>();
  for (const { segment } of seeds) {
    orderIndexes.add(segment.orderIndex - 1);
    orderIndexes.add(segment.orderIndex);
    orderIndexes.add(segment.orderIndex + 1);
  }
  return segments
    .filter(({ orderIndex }) => orderIndexes.has(orderIndex))
    .sort((left, right) => left.orderIndex - right.orderIndex);
}

function formatArticleMap(analyses: readonly ArticleSegmentAnalysis[]): string {
  return analyses
    .slice()
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((analysis) =>
      `[${analysis.segmentId} | order ${analysis.orderIndex}]\n${analysis.analysis}`)
    .join('\n\n');
}

function tokenize(text: string): string[] {
  return [...new Set(
    (text.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []),
  )];
}
