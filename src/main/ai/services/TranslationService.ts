import type { CleanedContent, ContentSegment } from '../../../shared/contracts/content.types';
import type { ProviderKind } from '../../../shared/contracts/provider.types';
import { DEFAULT_TRANSLATION_EXPERT_ID } from '../../../shared/contracts/translation-expert.types';
import {
  TRANSLATION_CONTEXT_PROMPT_VERSION,
  type TranslationContext,
} from '../../../shared/contracts/translation-context.types';
import {
  TRANSLATION_LANGUAGE_LABELS,
  TRANSLATION_SOURCE_LANGUAGES,
  TRANSLATION_TARGET_LANGUAGES,
  type TerminologyPackInfo,
  TranslationGenerateRequest,
  TranslationGenerateResponse,
  TranslationGetRequest,
  TranslationPrioritizeRequest,
  TranslationPrioritizeResponse,
  TranslationResult,
  TranslationSegment,
  TranslationState,
  TranslationStreamEvent,
} from '../../../shared/contracts/translation.types';
import {
  TRANSLATION_ERROR_CODES,
  TranslationError,
  toTranslationIpcError,
} from '../../../shared/errors/translation.errors';
import {
  ContentSegmenter,
  CONTENT_SEGMENTER_VERSION,
} from '../../feed/services/ContentSegmenter';
import type { ProviderProfileStore } from '../stores/ProviderProfileStore';
import type { SecretStore } from '../stores/SecretStore';
import type { TextGenerationProvider } from '../provider/TextGenerationProvider';
import { isLikelyAlreadyTargetLanguage } from '../provider/TranslationLanguage';
import { TranslationBatchStreamParser, type TranslationBatchOutput } from '../provider/TranslationBatchStream';
import { buildTranslationBatchPrompt, TRANSLATION_PROMPT_VERSION } from '../provider/TranslationPrompt';
import { renderExpertInstruction } from '../experts/ExpertCompiler';
import { parseTranslationOutput } from '../provider/TranslationHtml';
import { TranslationStore } from '../stores/TranslationStore';
import {
  EmptyTerminologyLookup,
  type TerminologyLookup,
} from '../stores/TerminologyStore';
import type {
  ResolvedTranslationExpert,
  TranslationExpertService,
} from './TranslationExpertService';
import {
  buildTranslationContextIdentity,
  type TranslationContextService,
} from './TranslationContextService';

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
  priorityRanks: Map<string, number>;
  batches: TranslationBatchWork[];
}

interface TranslationBatchWork {
  segments: TranslationSegment[];
  originalOrder: number;
}

interface SegmentTranslationInput {
  segment: TranslationSegment;
  terminologyCandidates: ReturnType<TerminologyLookup['findCandidates']>;
}

interface TranslationProviderConfig {
  providerKind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  profileId: number;
  expert: ResolvedTranslationExpert;
  expertInstruction?: string;
  context?: TranslationContext;
  abortController: AbortController;
}

const MAX_BATCH_SEGMENTS = 3;
const MAX_BATCH_SOURCE_CHARACTERS = 1_600;
const MAX_CONCURRENT_BATCHES = 2;
const MAX_TERMINOLOGY_CANDIDATES = 5;

/** Bounded-concurrency Translation runtime with progressive per-segment persistence. */
export class TranslationService {
  private activeRun: ActiveTranslationRun | null = null;
  private executeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<(event: TranslationStreamEvent) => void>();

  constructor(
    private readonly contentLookup: TranslationContentLookup,
    private readonly profileStore: ProviderProfileStore,
    private readonly secretStore: SecretStore,
    private readonly translationStore: TranslationStore,
    private readonly provider: TextGenerationProvider,
    private readonly segmenter = new ContentSegmenter(),
    private readonly terminologyLookup: TerminologyLookup = new EmptyTerminologyLookup(),
    private readonly expertService?: TranslationExpertService,
    private readonly contextService?: TranslationContextService,
  ) {}

  subscribe(listener: (event: TranslationStreamEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(request: TranslationGetRequest): TranslationState {
    validateTranslationRequest(request);
    const source = this.getSource(request.entryId);
    const terminologyPackVersion = this.getTerminologyVersion(request);
    const expert = this.resolveExpert(request.expertId);
    const smartContextEnabled = request.useSmartContext === true;
    const compatibleResult = this.translationStore.findCompatibleResult(
      request.entryId,
      request.sourceLanguage,
      request.targetLanguage,
      source.sourceContentHash,
      source.segmenterVersion,
      TRANSLATION_PROMPT_VERSION,
      terminologyPackVersion,
      expert.id,
      expert.contentHash,
      smartContextEnabled,
      smartContextEnabled ? TRANSLATION_CONTEXT_PROMPT_VERSION : 'none',
    );
    if (compatibleResult) return toState(compatibleResult);

    return this.translationStore.findLatestResult(
      request.entryId,
      request.sourceLanguage,
      request.targetLanguage,
    )
      ? { state: 'stale' }
      : { state: 'idle' };
  }

  generate(request: TranslationGenerateRequest): TranslationGenerateResponse {
    validateTranslationRequest(request);
    const source = this.getSource(request.entryId);
    const terminologyPackVersion = this.getTerminologyVersion(request);
    const expert = this.resolveExpert(request.expertId);
    const smartContextEnabled = request.useSmartContext === true;
    const existingResult = this.translationStore.findCompatibleResult(
      request.entryId,
      request.sourceLanguage,
      request.targetLanguage,
      source.sourceContentHash,
      source.segmenterVersion,
      TRANSLATION_PROMPT_VERSION,
      terminologyPackVersion,
      expert.id,
      expert.contentHash,
      smartContextEnabled,
      smartContextEnabled ? TRANSLATION_CONTEXT_PROMPT_VERSION : 'none',
    );
    if (existingResult?.status === 'succeeded') {
      return { runId: existingResult.id, reused: true, result: existingResult };
    }

    if (this.activeRun) {
      if (
        this.activeRun.result.entryId === request.entryId
        && this.activeRun.result.sourceLanguage === request.sourceLanguage
        && this.activeRun.result.targetLanguage === request.targetLanguage
        && this.activeRun.result.sourceContentHash === source.sourceContentHash
        && this.activeRun.result.terminologyPackVersion === terminologyPackVersion
        && this.activeRun.result.expertId === expert.id
        && this.activeRun.result.expertContentHash === expert.contentHash
        && this.activeRun.result.smartContextEnabled === smartContextEnabled
      ) {
        return {
          runId: this.activeRun.result.id,
          reused: true,
          result: existingResult ?? this.activeRun.result,
        };
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
    const result = existingResult
      ? this.translationStore.resumeRun(existingResult.id, profile.id)
      : this.translationStore.createRun({
          entryId: request.entryId,
          providerProfileId: profile.id,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          sourceContentHash: source.sourceContentHash,
          segmenterVersion: source.segmenterVersion,
          promptVersion: TRANSLATION_PROMPT_VERSION,
          terminologyPackVersion,
          expertId: expert.id,
          expertContentHash: expert.contentHash,
          smartContextEnabled,
          contextPromptVersion: smartContextEnabled
            ? TRANSLATION_CONTEXT_PROMPT_VERSION
            : 'none',
          segments: source.segments,
        });
    const abortController = new AbortController();
    this.activeRun = {
      result,
      abortController,
      priorityRanks: new Map(),
      batches: [],
    };
    this.emit({
      type: 'started',
      runId: result.id,
      entryId: result.entryId,
      sourceLanguage: result.sourceLanguage,
      targetLanguage: result.targetLanguage,
    });
    this.executeTimer = setTimeout(() => {
      this.executeTimer = undefined;
      void this.executeRun(result, {
        providerKind: profile.providerKind,
        baseUrl: profile.baseUrl,
        model: profile.model,
        apiKey,
        profileId: profile.id,
        expert,
        abortController,
      });
    }, 0);
    return { runId: result.id, reused: false, result };
  }

  prioritize(request: TranslationPrioritizeRequest): TranslationPrioritizeResponse {
    validateTranslationRequest(request);
    const active = this.activeRun;
    if (
      !active
      || active.result.id !== request.runId
      || active.result.entryId !== request.entryId
      || active.result.sourceLanguage !== request.sourceLanguage
      || active.result.targetLanguage !== request.targetLanguage
      || active.result.terminologyPackVersion !== this.getTerminologyVersion(request)
      || active.result.expertId !== this.resolveExpert(request.expertId).id
      || active.result.smartContextEnabled !== (request.useSmartContext === true)
    ) {
      return { accepted: false };
    }
    active.priorityRanks.clear();
    request.sourceSegmentIds.forEach((sourceSegmentId, rank) => {
      active.priorityRanks.set(sourceSegmentId, rank);
    });
    return { accepted: true };
  }

  abortActiveRun(): void {
    if (!this.activeRun) return;
    const activeRun = this.activeRun;
    if (this.executeTimer) {
      clearTimeout(this.executeTimer);
      this.executeTimer = undefined;
    }
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
      sourceLanguage: activeRun.result.sourceLanguage,
      targetLanguage: activeRun.result.targetLanguage,
      error,
    });
    this.activeRun = null;
  }

  private async executeRun(
    result: TranslationResult,
    providerConfig: TranslationProviderConfig,
  ): Promise<void> {
    try {
      providerConfig.expertInstruction = this.renderExpertInstruction(
        providerConfig.expert,
        result,
      );
      if (result.smartContextEnabled) {
        const contextOutcome = this.contextService
          ? await this.contextService.resolve({
              identity: buildTranslationContextIdentity({
                sourceContentHash: result.sourceContentHash,
                sourceLanguage: result.sourceLanguage,
                targetLanguage: result.targetLanguage,
                providerProfileId: providerConfig.profileId,
                providerModel: providerConfig.model,
                expertId: result.expertId,
                expertContentHash: result.expertContentHash,
              }),
              sourceLanguage: result.sourceLanguage,
              targetLanguage: result.targetLanguage,
              articleText: result.segments.map((segment) => segment.sourceText).join('\n\n'),
              expertInstruction: providerConfig.expertInstruction,
              provider: {
                kind: providerConfig.providerKind,
                baseUrl: providerConfig.baseUrl,
                model: providerConfig.model,
                apiKey: providerConfig.apiKey,
              },
              signal: providerConfig.abortController.signal,
            })
          : {
              reused: false,
              warning: {
                code: TRANSLATION_ERROR_CODES.TRANSLATION_CONTEXT_UNAVAILABLE,
                message: 'Smart context is unavailable, so Translation continued without it.',
                retryable: true,
              },
            };
        providerConfig.context = contextOutcome.context;
        this.translationStore.setContextWarning(result.id, contextOutcome.warning);
      }

      const untranslatedSegments: TranslationSegment[] = [];
      for (const segment of result.segments) {
        if (segment.status === 'succeeded') continue;
        if (
          result.sourceLanguage === result.targetLanguage
          || isLikelyAlreadyTargetLanguage(segment.sourceText, result.targetLanguage)
        ) {
          const completedSegment = this.translationStore.markSegmentSucceeded(
            result.id,
            segment.sourceSegmentId,
            segment.sourceText,
            segment.sourceHtml,
            [],
          );
          this.emit({
            type: 'segment-completed',
            runId: result.id,
            entryId: result.entryId,
            sourceLanguage: result.sourceLanguage,
            targetLanguage: result.targetLanguage,
            sourceSegmentId: segment.sourceSegmentId,
            segment: completedSegment,
          });
          continue;
        }
        untranslatedSegments.push(segment);
      }

      const active = this.activeRun;
      if (!active || active.result.id !== result.id) return;
      active.batches = createAdjacentBatches(untranslatedSegments);
      let failure: { error: unknown; sourceSegmentId?: string } | undefined;
      const worker = async (): Promise<void> => {
        while (!providerConfig.abortController.signal.aborted) {
          const batch = this.takeNextBatch(active);
          if (!batch) return;
          try {
            await this.processBatch(result, batch, providerConfig);
          } catch (error) {
            if (!failure) {
              failure = { error, sourceSegmentId: batch.segments[0]?.sourceSegmentId };
              providerConfig.abortController.abort();
            }
            return;
          }
        }
      };
      await Promise.all(Array.from(
        { length: Math.min(MAX_CONCURRENT_BATCHES, active.batches.length) },
        () => worker(),
      ));

      if (this.activeRun?.result.id !== result.id) return;
      if (failure) {
        const translatedFailure = failure as { error: unknown; sourceSegmentId?: string };
        const ipcError = toTranslationIpcError(translatedFailure.error);
        this.translationStore.markRunFailed(result.id, ipcError, translatedFailure.sourceSegmentId);
        this.emit({
          type: 'failed',
          runId: result.id,
          entryId: result.entryId,
          sourceLanguage: result.sourceLanguage,
          targetLanguage: result.targetLanguage,
          error: ipcError,
        });
        return;
      }

      const completedResult = this.translationStore.markRunSucceeded(result.id);
      this.emit({
        type: 'completed',
        runId: result.id,
        entryId: result.entryId,
        sourceLanguage: result.sourceLanguage,
        targetLanguage: result.targetLanguage,
        result: completedResult,
      });
    } catch (error) {
      if (this.activeRun?.result.id !== result.id) return;
      const failure = toTranslationIpcError(error);
      this.translationStore.markRunFailed(result.id, failure, this.activeRun.sourceSegmentId);
      this.emit({
        type: 'failed',
        runId: result.id,
        entryId: result.entryId,
        sourceLanguage: result.sourceLanguage,
        targetLanguage: result.targetLanguage,
        error: failure,
      });
    } finally {
      if (this.activeRun?.result.id === result.id) this.activeRun = null;
    }
  }

  private takeNextBatch(active: ActiveTranslationRun): TranslationBatchWork | undefined {
    let selectedIndex = -1;
    let selectedPriority = Number.POSITIVE_INFINITY;
    active.batches.forEach((batch, index) => {
      const visibleRank = Math.min(...batch.segments.map((segment) =>
        active.priorityRanks.get(segment.sourceSegmentId) ?? Number.POSITIVE_INFINITY));
      const priority = Number.isFinite(visibleRank)
        ? visibleRank
        : 10_000 + batch.originalOrder;
      if (priority < selectedPriority) {
        selectedPriority = priority;
        selectedIndex = index;
      }
    });
    if (selectedIndex < 0) return undefined;
    return active.batches.splice(selectedIndex, 1)[0];
  }

  private async processBatch(
    result: TranslationResult,
    batch: TranslationBatchWork,
    providerConfig: TranslationProviderConfig,
  ): Promise<void> {
    const active = this.activeRun;
    if (!active || active.result.id !== result.id) return;
    active.sourceSegmentId = batch.segments[0]?.sourceSegmentId;
    batch.segments.forEach((segment) => this.emit({
      type: 'segment-started',
      runId: result.id,
      entryId: result.entryId,
      sourceLanguage: result.sourceLanguage,
      targetLanguage: result.targetLanguage,
      sourceSegmentId: segment.sourceSegmentId,
      orderIndex: segment.orderIndex,
    }));

    const inputs = batch.segments.map((segment) => this.buildSegmentInput(result, segment));
    const buildPrompt = (selectedInputs: SegmentTranslationInput[]): string =>
      buildTranslationBatchPrompt({
        sourceLanguage: result.sourceLanguage,
        targetLanguage: result.targetLanguage,
        articleTitle: result.segments.find((segment) =>
          segment.sourceType === 'title')?.sourceText,
        expertInstruction: providerConfig.expertInstruction,
        translationContext: providerConfig.context,
        segments: selectedInputs.map(({ segment, terminologyCandidates }) => ({
          sourceSegmentId: segment.sourceSegmentId,
          sourceHtml: segment.sourceHtml,
          sourceType: segment.sourceType,
          terminologyCandidates,
        })),
      });
    const requestStartedAt = Date.now();
    let responseHeadersAt: number | undefined;
    let firstDeltaAt: number | undefined;
    let lastDeltaAt: number | undefined;
    let outputCharacters = 0;
    let providerRequestCount = 0;
    const completedIds = new Set<string>();

    const persistOutputs = (outputs: TranslationBatchOutput[]): void => {
      outputs.forEach((output) => {
        if (completedIds.has(output.sourceSegmentId)) {
          throw invalidBatchOutput('The provider returned a duplicate Translation segment.');
        }
        const input = inputs.find(({ segment }) =>
          segment.sourceSegmentId === output.sourceSegmentId);
        if (!input) {
          throw invalidBatchOutput('The provider returned an unknown Translation segment.');
        }
        const parsed = parseTranslationOutput(
          input.segment.sourceHtml,
          JSON.stringify({
            translatedHtml: output.translatedHtml,
            appliedTermIds: output.appliedTermIds,
          }),
          input.terminologyCandidates,
        );
        const completedSegment = this.translationStore.markSegmentSucceeded(
          result.id,
          input.segment.sourceSegmentId,
          parsed.translatedText,
          parsed.translatedHtml,
          parsed.terminologyMatches,
        );
        completedIds.add(output.sourceSegmentId);
        this.emit({
          type: 'segment-completed',
          runId: result.id,
          entryId: result.entryId,
          sourceLanguage: result.sourceLanguage,
          targetLanguage: result.targetLanguage,
          sourceSegmentId: output.sourceSegmentId,
          segment: completedSegment,
        });
      });
    };

    const streamPrompt = async (prompt: string): Promise<void> => {
      const parser = new TranslationBatchStreamParser();
      providerRequestCount += 1;
      for await (const delta of this.provider.stream({
        providerKind: providerConfig.providerKind,
        baseUrl: providerConfig.baseUrl,
        model: providerConfig.model,
        apiKey: providerConfig.apiKey,
        prompt,
        signal: providerConfig.abortController.signal,
        onTiming: (phase) => {
          if (phase === 'response-headers') responseHeadersAt ??= Date.now();
          if (phase === 'first-delta') firstDeltaAt ??= Date.now();
        },
      })) {
        lastDeltaAt = Date.now();
        outputCharacters += delta.length;
        let completedOutputs: ReturnType<TranslationBatchStreamParser['append']>;
        try {
          completedOutputs = parser.append(delta);
        } catch {
          throw invalidBatchOutput('The provider returned invalid Translation NDJSON.');
        }
        persistOutputs(completedOutputs);
      }
      let finalOutputs: TranslationBatchOutput[];
      try {
        finalOutputs = parser.finish();
      } catch {
        throw invalidBatchOutput('The provider returned invalid Translation NDJSON.');
      }
      persistOutputs(finalOutputs);
    };

    await streamPrompt(buildPrompt(inputs));
    const missingInputs = inputs.filter(({ segment }) =>
      !completedIds.has(segment.sourceSegmentId));
    if (missingInputs.length) {
      console.warn('[translation:missing-segment-recovery]', JSON.stringify({
        runId: result.id,
        sourceSegmentIds: missingInputs.map(({ segment }) => segment.sourceSegmentId),
      }));
      for (const missingInput of missingInputs) {
        await streamPrompt(buildPrompt([missingInput]));
      }
    }
    if (completedIds.size !== inputs.length) {
      throw invalidBatchOutput('The provider omitted a Translation segment.');
    }
    const persistedAt = Date.now();
    console.info('[translation:timing]', JSON.stringify({
      runId: result.id,
      sourceSegmentIds: inputs.map(({ segment }) => segment.sourceSegmentId),
      responseHeadersMs: responseHeadersAt === undefined
        ? undefined
        : responseHeadersAt - requestStartedAt,
      firstDeltaMs: firstDeltaAt === undefined ? undefined : firstDeltaAt - requestStartedAt,
      lastDeltaMs: lastDeltaAt === undefined ? undefined : lastDeltaAt - requestStartedAt,
      persistedMs: persistedAt - requestStartedAt,
      persistenceMs: lastDeltaAt === undefined ? undefined : persistedAt - lastDeltaAt,
      providerRequestCount,
      inputCharacters: inputs.reduce((total, input) => total + input.segment.sourceText.length, 0),
      outputCharacters,
    }));
  }

  private buildSegmentInput(
    result: TranslationResult,
    segment: TranslationSegment,
  ): SegmentTranslationInput {
    if (result.terminologyPackVersion === 'none') {
      return { segment, terminologyCandidates: [] };
    }
    const segmentIndex = result.segments.findIndex((candidate) =>
      candidate.sourceSegmentId === segment.sourceSegmentId);
    const terminologyContext = [
      segment.sourceText,
      result.segments.find((candidate) => candidate.sourceType === 'title')?.sourceText,
      result.segments[segmentIndex - 1]?.sourceText,
      result.segments[segmentIndex + 1]?.sourceText,
    ].filter((value): value is string => Boolean(value)).join('\n');
    return {
      segment,
      terminologyCandidates: this.terminologyLookup.findCandidates(
        terminologyContext,
        result.targetLanguage,
        result.terminologyPackVersion,
      ).slice(0, MAX_TERMINOLOGY_CANDIDATES),
    };
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
      && content.segmenterVersion === CONTENT_SEGMENTER_VERSION
      && content.sourceContentHash
      && hasCurrentMetadata(content.segments, content.readerTitle)
      ? {
          segments: content.segments,
          sourceContentHash: content.sourceContentHash,
          segmenterVersion: content.segmenterVersion,
        }
      : this.segmenter.segment(content.cleanedHtml, {
          title: content.readerTitle ?? content.readabilityTitle,
          byline: content.readerByline ?? content.readabilityByline,
        });

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

  close(): void {
    this.abortActiveRun();
    this.terminologyLookup.close?.();
  }

  getTerminologyInfo(): TerminologyPackInfo {
    return this.terminologyLookup.getInfo();
  }

  private getTerminologyVersion(request: TranslationGetRequest): string {
    return request.useTerminology === false
      ? 'none'
      : this.terminologyLookup.getVersion();
  }

  private resolveExpert(expertId: string | undefined): ResolvedTranslationExpert {
    return this.expertService?.resolve(expertId) ?? {
      id: DEFAULT_TRANSLATION_EXPERT_ID,
      contentHash: DEFAULT_TRANSLATION_EXPERT_ID,
    };
  }

  private renderExpertInstruction(
    expert: ResolvedTranslationExpert,
    result: TranslationResult,
  ): string | undefined {
    if (!expert.expert) return undefined;
    return renderExpertInstruction(
      expert.expert.instruction,
      result.sourceLanguage === 'auto'
        ? 'automatically detected source language'
        : TRANSLATION_LANGUAGE_LABELS[result.sourceLanguage],
      TRANSLATION_LANGUAGE_LABELS[result.targetLanguage],
    );
  }
}

function hasCurrentMetadata(
  segments: ContentSegment[],
  title: string | undefined,
): boolean {
  const storedTitle = segments.find((segment) => segment.type === 'title')?.sourceText;
  return normalizeMetadata(storedTitle) === normalizeMetadata(title);
}

function normalizeMetadata(value: string | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function createAdjacentBatches(segments: TranslationSegment[]): TranslationBatchWork[] {
  const batches: TranslationBatchWork[] = [];
  let current: TranslationSegment[] = [];
  let currentCharacters = 0;
  const flush = (): void => {
    if (!current.length) return;
    batches.push({ segments: current, originalOrder: current[0]?.orderIndex ?? batches.length });
    current = [];
    currentCharacters = 0;
  };
  segments.forEach((segment) => {
    const wouldExceedCount = current.length >= MAX_BATCH_SEGMENTS;
    const wouldExceedCharacters = current.length > 0
      && currentCharacters + segment.sourceText.length > MAX_BATCH_SOURCE_CHARACTERS;
    const previous = current.at(-1);
    const isNotAdjacent = previous !== undefined
      && segment.orderIndex !== previous.orderIndex + 1;
    if (wouldExceedCount || wouldExceedCharacters || isNotAdjacent) flush();
    current.push(segment);
    currentCharacters += segment.sourceText.length;
  });
  flush();
  return batches;
}

function invalidBatchOutput(message: string): TranslationError {
  return new TranslationError(
    TRANSLATION_ERROR_CODES.TRANSLATION_INVALID_STRUCTURE,
    message,
    true,
  );
}

function validateTranslationRequest(request: TranslationGetRequest): void {
  if (
    !Number.isInteger(request.entryId)
    || request.entryId <= 0
    || !TRANSLATION_SOURCE_LANGUAGES.includes(request.sourceLanguage)
    || !TRANSLATION_TARGET_LANGUAGES.includes(request.targetLanguage)
    || (request.useTerminology !== undefined && typeof request.useTerminology !== 'boolean')
    || (request.useSmartContext !== undefined && typeof request.useSmartContext !== 'boolean')
    || (request.expertId !== undefined
      && (typeof request.expertId !== 'string' || !request.expertId.trim()))
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
