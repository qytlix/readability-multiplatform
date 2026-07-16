import type { CleanedContent, ContentSegment } from '../../shared/contracts/content.types';
import type {
  TranslationGenerateRequest,
  TranslationGenerateResponse,
  TranslationGetRequest,
  TranslationResult,
  TranslationState,
  TranslationStreamEvent,
} from '../../shared/contracts/translation.types';
import { TRANSLATION_TARGET_LANGUAGES } from '../../shared/contracts/translation.types';
import {
  TRANSLATION_ERROR_CODES,
  TranslationError,
  toTranslationIpcError,
} from '../../shared/errors/translation.errors';
import { ContentSegmenter } from '../feed/ContentSegmenter';
import type { ProviderProfileStore } from './ProviderProfileStore';
import type { SecretStore } from './SecretStore';
import type { SummaryProvider } from './SummaryProvider';
import { buildTranslationPrompt, TRANSLATION_PROMPT_VERSION } from './TranslationPrompt';
import { TranslationStore } from './TranslationStore';

export interface TranslationContentLookup {
  findByEntry(entryId: number): CleanedContent | undefined;
}

interface TranslationSource {
  segments: ContentSegment[];
  sourceContentHash: string;
  segmenterVersion: string;
}

interface ActiveTranslationRun {
  result: TranslationResult;
  abortController: AbortController;
  sourceSegmentId?: string;
}

/** Serial Translation P0 runtime with persisted per-segment final output. */
export class TranslationService {
  private activeRun: ActiveTranslationRun | null = null;
  private readonly listeners = new Set<(event: TranslationStreamEvent) => void>();

  constructor(
    private readonly contentLookup: TranslationContentLookup,
    private readonly profileStore: ProviderProfileStore,
    private readonly secretStore: SecretStore,
    private readonly translationStore: TranslationStore,
    private readonly provider: SummaryProvider,
    private readonly segmenter = new ContentSegmenter(),
  ) {}

  subscribe(listener: (event: TranslationStreamEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(request: TranslationGetRequest): TranslationState {
    validateTranslationRequest(request);
    const source = this.getSource(request.entryId);
    const compatibleResult = this.translationStore.findCompatibleResult(
      request.entryId,
      request.targetLanguage,
      source.sourceContentHash,
      source.segmenterVersion,
    );
    if (compatibleResult) return toState(compatibleResult);

    return this.translationStore.findLatestResult(
      request.entryId,
      request.targetLanguage,
    )
      ? { state: 'stale' }
      : { state: 'idle' };
  }

  generate(request: TranslationGenerateRequest): TranslationGenerateResponse {
    validateTranslationRequest(request);
    const source = this.getSource(request.entryId);
    const existingResult = this.translationStore.findCompatibleResult(
      request.entryId,
      request.targetLanguage,
      source.sourceContentHash,
      source.segmenterVersion,
    );
    if (existingResult?.status === 'succeeded') {
      return { runId: existingResult.id, reused: true };
    }

    if (this.activeRun) {
      if (
        this.activeRun.result.entryId === request.entryId
        && this.activeRun.result.targetLanguage === request.targetLanguage
        && this.activeRun.result.sourceContentHash === source.sourceContentHash
      ) {
        return { runId: this.activeRun.result.id, reused: true };
      }
      throw new TranslationError(
        TRANSLATION_ERROR_CODES.TRANSLATION_BUSY,
        'Another Translation is already being generated. Wait for it to finish before starting another.',
        true,
      );
    }

    const profile = this.profileStore.findActiveWithSecret();
    if (!profile) {
      throw new TranslationError(
        TRANSLATION_ERROR_CODES.TRANSLATION_PROVIDER_NOT_CONFIGURED,
        'Configure a provider before generating a Translation.',
        false,
      );
    }

    const apiKey = this.secretStore.read(profile.apiKeyRef);
    const result = this.translationStore.createRun({
      entryId: request.entryId,
      providerProfileId: profile.id,
      targetLanguage: request.targetLanguage,
      sourceContentHash: source.sourceContentHash,
      segmenterVersion: source.segmenterVersion,
      promptVersion: TRANSLATION_PROMPT_VERSION,
      segments: source.segments,
    });
    const abortController = new AbortController();
    this.activeRun = { result, abortController };
    this.emit({
      type: 'started',
      runId: result.id,
      entryId: result.entryId,
      targetLanguage: result.targetLanguage,
    });
    void this.executeRun(result, {
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey,
      abortController,
    });
    return { runId: result.id, reused: false };
  }

  abortActiveRun(): void {
    if (!this.activeRun) return;
    const activeRun = this.activeRun;
    const error = toTranslationIpcError(new TranslationError(
      TRANSLATION_ERROR_CODES.TRANSLATION_INTERRUPTED,
      'Translation generation was interrupted before completion.',
      true,
    ));
    activeRun.abortController.abort();
    this.translationStore.markRunFailed(
      activeRun.result.id,
      error,
      activeRun.sourceSegmentId,
    );
    this.emit({
      type: 'failed',
      runId: activeRun.result.id,
      entryId: activeRun.result.entryId,
      targetLanguage: activeRun.result.targetLanguage,
      error,
    });
    this.activeRun = null;
  }

  private async executeRun(
    result: TranslationResult,
    providerConfig: {
      baseUrl: string;
      model: string;
      apiKey: string;
      abortController: AbortController;
    },
  ): Promise<void> {
    let currentSegmentId: string | undefined;
    try {
      for (const segment of result.segments) {
        currentSegmentId = segment.sourceSegmentId;
        if (this.activeRun?.result.id === result.id) {
          this.activeRun.sourceSegmentId = currentSegmentId;
        }
        this.emit({
          type: 'segment-started',
          runId: result.id,
          entryId: result.entryId,
          targetLanguage: result.targetLanguage,
          sourceSegmentId: segment.sourceSegmentId,
          orderIndex: segment.orderIndex,
        });
        const prompt = buildTranslationPrompt({
          sourceText: segment.sourceText,
          targetLanguage: result.targetLanguage,
        });
        let output = '';
        for await (const delta of this.provider.stream({
          baseUrl: providerConfig.baseUrl,
          model: providerConfig.model,
          apiKey: providerConfig.apiKey,
          prompt,
          signal: providerConfig.abortController.signal,
        })) {
          output += delta;
          this.emit({
            type: 'segment-delta',
            runId: result.id,
            entryId: result.entryId,
            targetLanguage: result.targetLanguage,
            sourceSegmentId: segment.sourceSegmentId,
            text: delta,
          });
        }
        if (!output.trim()) {
          throw new TranslationError(
            TRANSLATION_ERROR_CODES.TRANSLATION_EMPTY_OUTPUT,
            'The provider returned an empty Translation segment.',
            true,
          );
        }
        this.translationStore.markSegmentSucceeded(
          result.id,
          segment.sourceSegmentId,
          output.trim(),
        );
      }

      const completedResult = this.translationStore.markRunSucceeded(result.id);
      this.emit({
        type: 'completed',
        runId: result.id,
        entryId: result.entryId,
        targetLanguage: result.targetLanguage,
        result: completedResult,
      });
    } catch (error) {
      if (this.activeRun?.result.id !== result.id) return;
      const failure = toTranslationIpcError(error);
      this.translationStore.markRunFailed(result.id, failure, currentSegmentId);
      this.emit({
        type: 'failed',
        runId: result.id,
        entryId: result.entryId,
        targetLanguage: result.targetLanguage,
        error: failure,
      });
    } finally {
      if (this.activeRun?.result.id === result.id) this.activeRun = null;
    }
  }

  private getSource(entryId: number): TranslationSource {
    const content = this.contentLookup.findByEntry(entryId);
    if (
      !content
      || content.pipelineStatus !== 'success'
      || !content.cleanedHtml.trim()
    ) {
      throw new TranslationError(
        TRANSLATION_ERROR_CODES.TRANSLATION_CONTENT_UNAVAILABLE,
        'Translation needs successfully cleaned article content. Try opening the article again first.',
        true,
      );
    }

    const segmentedContent = content.segments?.length
      && content.segmenterVersion
      && content.sourceContentHash
      ? {
          segments: content.segments,
          sourceContentHash: content.sourceContentHash,
          segmenterVersion: content.segmenterVersion,
        }
      : this.segmenter.segment(content.cleanedHtml);

    if (!segmentedContent.segments.length) {
      throw new TranslationError(
        TRANSLATION_ERROR_CODES.TRANSLATION_CONTENT_UNAVAILABLE,
        'Translation needs at least one readable article paragraph or list.',
        true,
      );
    }
    return segmentedContent;
  }

  private emit(event: TranslationStreamEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}

function validateTranslationRequest(request: TranslationGetRequest): void {
  if (
    !Number.isInteger(request.entryId)
    || request.entryId <= 0
    || !TRANSLATION_TARGET_LANGUAGES.includes(request.targetLanguage)
  ) {
    throw new TranslationError(
      TRANSLATION_ERROR_CODES.TRANSLATION_INVALID_REQUEST,
      'The Translation request is invalid.',
      false,
    );
  }
}

function toState(result: TranslationResult): TranslationState {
  if (result.status === 'running') return { state: 'running', result };
  if (result.status === 'failed') return { state: 'failed', result };
  return { state: 'succeeded', result };
}
