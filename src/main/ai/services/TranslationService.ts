import { performance } from 'node:perf_hooks';
import type { CleanedContent, ContentSegment } from '../../../shared/contracts/content.types';
import type { ShaleError } from '../../../shared/contracts/feed.ipc';
import type {
  TerminologyPackInfo,
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
import { TRANSLATION_TARGET_LANGUAGES } from '../../../shared/contracts/translation.types';
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
import type { ProviderTokenUsage, SummaryProvider } from '../provider/SummaryProvider';
import {
  hasTranslatableText,
  isLikelyAlreadyTargetLanguage,
} from '../provider/TranslationLanguage';
import { TranslationBatchStreamParser, type TranslationBatchOutput } from '../provider/TranslationBatchStream';
import { buildTranslationBatchPrompt, TRANSLATION_PROMPT_VERSION } from '../provider/TranslationPrompt';
import { parseTranslationOutput } from '../provider/TranslationHtml';
import { TranslationStore } from '../stores/TranslationStore';
import {
  EmptyTerminologyLookup,
  type TerminologyLookup,
} from '../stores/TerminologyStore';
import {
  elapsedTranslationMilliseconds,
  logTranslationRecoveryCompleted,
  logTranslationMissingSegmentsDetected,
  logTranslationProviderRequestCompleted,
  logTranslationProviderRequestFailed,
  logTranslationProviderRequestStarted,
  logTranslationRunCompleted,
  logTranslationRunFailed,
  logTranslationRunInterrupted,
  logTranslationRunStarted,
  TRANSLATION_LOG_ERROR_CODES,
  type TranslationOperationLogger,
  type TranslationProviderRequestKind,
  type TranslationRunFailureStage,
} from './TranslationLogging';

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
  startedAt: number;
  terminalLogRecorded: boolean;
  diagnostics: TranslationRunDiagnostics;
  sourceSegmentId?: string;
  priorityRanks: Map<string, number>;
  batches: TranslationBatchWork[];
}

interface TranslationRunDiagnostics {
  providerRequestCount: number;
  batchRequestCount: number;
  compensationRequestCount: number;
  providerRequestSuccessCount: number;
  providerRequestFailureCount: number;
  missingSegmentCount: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

interface ActiveProviderRequest {
  providerRequestId: number;
  requestKind: TranslationProviderRequestKind;
  segmentCount: number;
  startedAt: number;
}

interface TranslationBatchWork {
  segments: TranslationSegment[];
  originalOrder: number;
}

interface SegmentTranslationInput {
  segment: TranslationSegment;
  terminologyCandidates: ReturnType<TerminologyLookup['findCandidates']>;
}

interface SegmentTranslationFailure {
  sourceSegmentId: string;
  error: ShaleError;
}

const MAX_BATCH_SEGMENTS = 3;
const MAX_BATCH_SOURCE_CHARACTERS = 1_600;
const MAX_CONCURRENT_BATCHES = 2;
const MAX_TERMINOLOGY_CANDIDATES = 5;
/**
 * A failed batch can be retried only once per remaining segment. This matches
 * the batch-size limit and prevents compensation from recursively multiplying
 * provider requests.
 */
const MAX_COMPENSATION_REQUESTS_PER_BATCH = MAX_BATCH_SEGMENTS;

let latestProviderRequestId = 0;

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
    private readonly provider: SummaryProvider,
    private readonly segmenter = new ContentSegmenter(),
    private readonly terminologyLookup: TerminologyLookup = new EmptyTerminologyLookup(),
    private readonly logger?: TranslationOperationLogger,
  ) {}

  subscribe(listener: (event: TranslationStreamEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(request: TranslationGetRequest): TranslationState {
    validateTranslationRequest(request);
    const source = this.getSource(request.entryId);
    const terminologyPackVersion = this.getTerminologyVersion(request);
    const compatibleResult = this.translationStore.findCompatibleResult(
      request.entryId,
      request.targetLanguage,
      source.sourceContentHash,
      source.segmenterVersion,
      TRANSLATION_PROMPT_VERSION,
      terminologyPackVersion,
    );
    if (compatibleResult) return toState(compatibleResult);

    return this.translationStore.findLatestResult(
      request.entryId,
      request.targetLanguage,
    )
      ? { state: 'stale' }
      : { state: 'idle' };
  }

  reconcileInterruptedRuns(): void {
    const startedAt = performance.now();
    const count = this.translationStore.reconcileInterruptedRuns();
    logTranslationRecoveryCompleted(this.logger, {
      durationMs: elapsedTranslationMilliseconds(startedAt),
      count,
    });
  }

  generate(request: TranslationGenerateRequest): TranslationGenerateResponse {
    validateTranslationRequest(request);
    const source = this.getSource(request.entryId);
    const terminologyPackVersion = this.getTerminologyVersion(request);
    const existingResult = this.translationStore.findCompatibleResult(
      request.entryId,
      request.targetLanguage,
      source.sourceContentHash,
      source.segmenterVersion,
      TRANSLATION_PROMPT_VERSION,
      terminologyPackVersion,
    );
    if (existingResult?.status === 'succeeded') {
      return { runId: existingResult.id, reused: true, result: existingResult };
    }

    if (this.activeRun) {
      if (
        this.activeRun.result.entryId === request.entryId
        && this.activeRun.result.targetLanguage === request.targetLanguage
        && this.activeRun.result.sourceContentHash === source.sourceContentHash
        && this.activeRun.result.terminologyPackVersion === terminologyPackVersion
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
          targetLanguage: request.targetLanguage,
          sourceContentHash: source.sourceContentHash,
          segmenterVersion: source.segmenterVersion,
          promptVersion: TRANSLATION_PROMPT_VERSION,
          terminologyPackVersion,
          segments: source.segments,
        });
    const abortController = new AbortController();
    const startedAt = performance.now();
    this.activeRun = {
      result,
      abortController,
      startedAt,
      terminalLogRecorded: false,
      diagnostics: createTranslationRunDiagnostics(),
      priorityRanks: new Map(),
      batches: [],
    };
    this.emit({
      type: 'started',
      runId: result.id,
      entryId: result.entryId,
      targetLanguage: result.targetLanguage,
    });
    logTranslationRunStarted(this.logger, { taskRunId: result.id });
    this.executeTimer = setTimeout(() => {
      this.executeTimer = undefined;
      void this.executeRun(result, {
        baseUrl: profile.baseUrl,
        model: profile.model,
        apiKey,
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
      || active.result.targetLanguage !== request.targetLanguage
      || active.result.terminologyPackVersion !== this.getTerminologyVersion(request)
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
    this.logRunInterrupted(activeRun);
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
    let stage: TranslationRunFailureStage = 'stream';
    try {
      const untranslatedSegments: TranslationSegment[] = [];
      for (const segment of result.segments) {
        if (segment.status === 'succeeded') continue;
        if (
          !hasTranslatableText(segment.sourceText)
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
      const segmentFailures: SegmentTranslationFailure[] = [];
      const worker = async (): Promise<void> => {
        while (!providerConfig.abortController.signal.aborted) {
          const batch = this.takeNextBatch(active);
          if (!batch) return;
          try {
            segmentFailures.push(...await this.processBatch(result, batch, providerConfig));
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
        const activeRun = this.activeRun;
        if (activeRun?.result.id === result.id) {
          this.logRunFailure(activeRun, stage, ipcError.code);
        }
        this.emit({
          type: 'failed',
          runId: result.id,
          entryId: result.entryId,
          targetLanguage: result.targetLanguage,
          error: ipcError,
        });
        return;
      }

      if (segmentFailures.length) {
        const firstFailure = segmentFailures[0];
        if (!firstFailure) return;
        this.translationStore.markRunFailed(result.id, firstFailure.error);
        const activeRun = this.activeRun;
        if (activeRun?.result.id === result.id) {
          this.logRunFailure(activeRun, stage, firstFailure.error.code);
        }
        this.emit({
          type: 'failed',
          runId: result.id,
          entryId: result.entryId,
          targetLanguage: result.targetLanguage,
          error: firstFailure.error,
        });
        return;
      }

      stage = 'persist';
      const completedResult = this.translationStore.markRunSucceeded(result.id);
      const activeRun = this.activeRun;
      if (activeRun?.result.id === result.id) {
        this.logRunCompleted(activeRun);
      }
      this.emit({
        type: 'completed',
        runId: result.id,
        entryId: result.entryId,
        targetLanguage: result.targetLanguage,
        result: completedResult,
      });
    } catch (error) {
      const activeRun = this.activeRun;
      if (
        !activeRun
        || activeRun.result.id !== result.id
        || activeRun.terminalLogRecorded
      ) {
        return;
      }
      const failure = toTranslationIpcError(error);
      this.translationStore.markRunFailed(result.id, failure, activeRun.sourceSegmentId);
      if (failure.code === TRANSLATION_ERROR_CODES.TRANSLATION_INTERRUPTED) {
        this.logRunInterrupted(activeRun);
      } else {
        this.logRunFailure(activeRun, stage, failure.code);
      }
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
    providerConfig: {
      baseUrl: string;
      model: string;
      apiKey: string;
      abortController: AbortController;
    },
  ): Promise<SegmentTranslationFailure[]> {
    const active = this.activeRun;
    if (!active || active.result.id !== result.id) return [];
    active.sourceSegmentId = batch.segments[0]?.sourceSegmentId;
    batch.segments.forEach((segment) => this.emit({
      type: 'segment-started',
      runId: result.id,
      entryId: result.entryId,
      targetLanguage: result.targetLanguage,
      sourceSegmentId: segment.sourceSegmentId,
      orderIndex: segment.orderIndex,
    }));

    const inputs = batch.segments.map((segment) => this.buildSegmentInput(result, segment));
    const buildPrompt = (selectedInputs: SegmentTranslationInput[]): string =>
      buildTranslationBatchPrompt({
        targetLanguage: result.targetLanguage,
        articleTitle: result.segments.find((segment) =>
          segment.sourceType === 'title')?.sourceText,
        segments: selectedInputs.map(({ segment, terminologyCandidates }) => ({
          sourceSegmentId: segment.sourceSegmentId,
          sourceHtml: segment.sourceHtml,
          sourceType: segment.sourceType,
          terminologyCandidates,
        })),
      });
    const settledIds = new Set<string>();
    const segmentFailures: SegmentTranslationFailure[] = [];
    let latestBatchProviderRequestId: number | undefined;

    const persistOutputs = (outputs: TranslationBatchOutput[]): void => {
      outputs.forEach((output) => {
        if (settledIds.has(output.sourceSegmentId)) {
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
        settledIds.add(output.sourceSegmentId);
        this.emit({
          type: 'segment-completed',
          runId: result.id,
          entryId: result.entryId,
          targetLanguage: result.targetLanguage,
          sourceSegmentId: output.sourceSegmentId,
          segment: completedSegment,
        });
      });
    };

    const streamPrompt = async (
      prompt: string,
      requestKind: TranslationProviderRequestKind,
      segmentCount: number,
    ): Promise<number> => {
      const parser = new TranslationBatchStreamParser();
      const providerRequest = this.startProviderRequest(active, requestKind, segmentCount);
      latestBatchProviderRequestId = providerRequest.providerRequestId;
      let usage: ProviderTokenUsage | undefined;
      try {
        for await (const delta of this.provider.stream({
          baseUrl: providerConfig.baseUrl,
          model: providerConfig.model,
          apiKey: providerConfig.apiKey,
          prompt,
          signal: providerConfig.abortController.signal,
          requestUsage: true,
          onUsage: (reportedUsage) => {
            usage = reportedUsage;
          },
        })) {
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
        this.completeProviderRequest(active, providerRequest, usage);
        return providerRequest.providerRequestId;
      } catch (error) {
        this.failProviderRequest(active, providerRequest, usage, toTranslationIpcError(error));
        throw error;
      }
    };

    const compensateMissingInputs = async (providerRequestId: number): Promise<void> => {
      const missingInputs = inputs.filter(({ segment }) =>
        !settledIds.has(segment.sourceSegmentId));
      if (!missingInputs.length) return;
      const compensationInputs = missingInputs.slice(0, MAX_COMPENSATION_REQUESTS_PER_BATCH);
      active.diagnostics.missingSegmentCount += missingInputs.length;
      logTranslationMissingSegmentsDetected(this.logger, {
        taskRunId: result.id,
        providerRequestId,
        missingSegmentCount: missingInputs.length,
      });
      for (const missingInput of compensationInputs) {
        try {
          await streamPrompt(buildPrompt([missingInput]), 'compensation', 1);
        } catch (error) {
          const translationError = toTranslationIpcError(error);
          if (!isSegmentOutputError(translationError.code)) throw error;
          const failedSegment = this.translationStore.markSegmentFailed(
            result.id,
            missingInput.segment.sourceSegmentId,
            translationError,
          );
          this.emit({
            type: 'segment-failed',
            runId: result.id,
            entryId: result.entryId,
            targetLanguage: result.targetLanguage,
            sourceSegmentId: missingInput.segment.sourceSegmentId,
            segment: failedSegment,
          });
          settledIds.add(missingInput.segment.sourceSegmentId);
          segmentFailures.push({
            sourceSegmentId: missingInput.segment.sourceSegmentId,
            error: translationError,
          });
        }
      }
      if (compensationInputs.length !== missingInputs.length) {
        throw invalidBatchOutput('The provider omitted too many Translation segments.');
      }
    };

    let batchRequestId: number;
    try {
      batchRequestId = await streamPrompt(buildPrompt(inputs), 'batch', inputs.length);
    } catch (error) {
      if (
        !isSegmentOutputError(toTranslationIpcError(error).code)
        || latestBatchProviderRequestId === undefined
      ) {
        throw error;
      }
      await compensateMissingInputs(latestBatchProviderRequestId);
      if (settledIds.size !== inputs.length) throw error;
      return segmentFailures;
    }

    await compensateMissingInputs(batchRequestId);
    if (settledIds.size !== inputs.length) {
      throw invalidBatchOutput('The provider omitted a Translation segment.');
    }
    return segmentFailures;
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

  private startProviderRequest(
    activeRun: ActiveTranslationRun,
    requestKind: TranslationProviderRequestKind,
    segmentCount: number,
  ): ActiveProviderRequest {
    const providerRequestId = createProviderRequestId();
    activeRun.diagnostics.providerRequestCount += 1;
    if (requestKind === 'batch') {
      activeRun.diagnostics.batchRequestCount += 1;
    } else {
      activeRun.diagnostics.compensationRequestCount += 1;
    }
    const request = {
      providerRequestId,
      requestKind,
      segmentCount,
      startedAt: performance.now(),
    };
    logTranslationProviderRequestStarted(this.logger, {
      taskRunId: activeRun.result.id,
      providerRequestId: request.providerRequestId,
      requestKind: request.requestKind,
      segmentCount: request.segmentCount,
    });
    return request;
  }

  private completeProviderRequest(
    activeRun: ActiveTranslationRun,
    request: ActiveProviderRequest,
    usage: ProviderTokenUsage | undefined,
  ): void {
    const reportedUsage = toSafeProviderTokenUsage(usage);
    this.recordProviderUsage(activeRun.diagnostics, reportedUsage);
    activeRun.diagnostics.providerRequestSuccessCount += 1;
    logTranslationProviderRequestCompleted(this.logger, {
      taskRunId: activeRun.result.id,
      providerRequestId: request.providerRequestId,
      requestKind: request.requestKind,
      segmentCount: request.segmentCount,
      durationMs: elapsedTranslationMilliseconds(request.startedAt),
      success: true,
      ...reportedUsage,
    });
  }

  private failProviderRequest(
    activeRun: ActiveTranslationRun,
    request: ActiveProviderRequest,
    usage: ProviderTokenUsage | undefined,
    error: { code: string },
  ): void {
    const reportedUsage = toSafeProviderTokenUsage(usage);
    this.recordProviderUsage(activeRun.diagnostics, reportedUsage);
    activeRun.diagnostics.providerRequestFailureCount += 1;
    logTranslationProviderRequestFailed(this.logger, {
      taskRunId: activeRun.result.id,
      providerRequestId: request.providerRequestId,
      requestKind: request.requestKind,
      segmentCount: request.segmentCount,
      durationMs: elapsedTranslationMilliseconds(request.startedAt),
      success: false,
      errorCode: toTranslationProviderRequestErrorCode(error.code),
      ...reportedUsage,
    });
  }

  private recordProviderUsage(
    diagnostics: TranslationRunDiagnostics,
    usage: ProviderTokenUsage | undefined,
  ): void {
    if (!usage) return;
    if (usage.inputTokens !== undefined) {
      diagnostics.inputTokens = (diagnostics.inputTokens ?? 0) + usage.inputTokens;
    }
    if (usage.outputTokens !== undefined) {
      diagnostics.outputTokens = (diagnostics.outputTokens ?? 0) + usage.outputTokens;
    }
    if (usage.totalTokens !== undefined) {
      diagnostics.totalTokens = (diagnostics.totalTokens ?? 0) + usage.totalTokens;
    }
  }

  private getRunDiagnosticSummary(activeRun: ActiveTranslationRun): TranslationRunDiagnostics {
    const diagnostics = activeRun.diagnostics;
    return {
      providerRequestCount: diagnostics.providerRequestCount,
      batchRequestCount: diagnostics.batchRequestCount,
      compensationRequestCount: diagnostics.compensationRequestCount,
      providerRequestSuccessCount: diagnostics.providerRequestSuccessCount,
      providerRequestFailureCount: diagnostics.providerRequestFailureCount,
      missingSegmentCount: diagnostics.missingSegmentCount,
      ...(diagnostics.inputTokens === undefined ? {} : { inputTokens: diagnostics.inputTokens }),
      ...(diagnostics.outputTokens === undefined ? {} : { outputTokens: diagnostics.outputTokens }),
      ...(diagnostics.totalTokens === undefined ? {} : { totalTokens: diagnostics.totalTokens }),
    };
  }

  private logRunCompleted(activeRun: ActiveTranslationRun): void {
    if (activeRun.terminalLogRecorded) return;
    activeRun.terminalLogRecorded = true;
    logTranslationRunCompleted(this.logger, {
      taskRunId: activeRun.result.id,
      durationMs: elapsedTranslationMilliseconds(activeRun.startedAt),
      success: true,
      ...this.getRunDiagnosticSummary(activeRun),
    });
  }

  private logRunFailure(
    activeRun: ActiveTranslationRun,
    stage: TranslationRunFailureStage,
    errorCode: string,
  ): void {
    if (activeRun.terminalLogRecorded) return;
    activeRun.terminalLogRecorded = true;
    logTranslationRunFailed(this.logger, {
      taskRunId: activeRun.result.id,
      durationMs: elapsedTranslationMilliseconds(activeRun.startedAt),
      success: false,
      stage,
      errorCode: toTranslationRunFailureErrorCode(stage, errorCode),
      ...this.getRunDiagnosticSummary(activeRun),
    });
  }

  private logRunInterrupted(activeRun: ActiveTranslationRun): void {
    if (activeRun.terminalLogRecorded) return;
    activeRun.terminalLogRecorded = true;
    logTranslationRunInterrupted(this.logger, {
      taskRunId: activeRun.result.id,
      durationMs: elapsedTranslationMilliseconds(activeRun.startedAt),
      success: false,
      stage: 'interrupt',
      errorCode: TRANSLATION_LOG_ERROR_CODES.interrupted,
    });
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

function createTranslationRunDiagnostics(): TranslationRunDiagnostics {
  return {
    providerRequestCount: 0,
    batchRequestCount: 0,
    compensationRequestCount: 0,
    providerRequestSuccessCount: 0,
    providerRequestFailureCount: 0,
    missingSegmentCount: 0,
  };
}

function createProviderRequestId(): number {
  const timestampBasedId = Date.now() * 1_000;
  latestProviderRequestId = Math.max(latestProviderRequestId + 1, timestampBasedId);
  return latestProviderRequestId;
}

function toSafeProviderTokenUsage(
  usage: ProviderTokenUsage | undefined,
): ProviderTokenUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = toSafeTokenCount(usage.inputTokens);
  const outputTokens = toSafeTokenCount(usage.outputTokens);
  const totalTokens = toSafeTokenCount(usage.totalTokens);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
}

function toSafeTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function invalidBatchOutput(message: string): TranslationError {
  return new TranslationError(
    TRANSLATION_ERROR_CODES.TRANSLATION_INVALID_STRUCTURE,
    message,
    true,
  );
}

function isSegmentOutputError(errorCode: string): boolean {
  return errorCode === TRANSLATION_ERROR_CODES.TRANSLATION_EMPTY_OUTPUT
    || errorCode === TRANSLATION_ERROR_CODES.TRANSLATION_INVALID_STRUCTURE;
}

function toTranslationRunFailureErrorCode(
  stage: TranslationRunFailureStage,
  errorCode: string,
): typeof TRANSLATION_LOG_ERROR_CODES[keyof typeof TRANSLATION_LOG_ERROR_CODES] {
  if (stage === 'persist') return TRANSLATION_LOG_ERROR_CODES.unknownError;

  return toTranslationProviderRequestErrorCode(errorCode);
}

function toTranslationProviderRequestErrorCode(
  errorCode: string,
): typeof TRANSLATION_LOG_ERROR_CODES[keyof typeof TRANSLATION_LOG_ERROR_CODES] {
  switch (errorCode) {
    case TRANSLATION_ERROR_CODES.TRANSLATION_EMPTY_OUTPUT:
      return TRANSLATION_LOG_ERROR_CODES.emptyOutput;
    case TRANSLATION_ERROR_CODES.TRANSLATION_INVALID_STRUCTURE:
      return TRANSLATION_LOG_ERROR_CODES.invalidStructure;
    case TRANSLATION_ERROR_CODES.TRANSLATION_PROVIDER_AUTH:
      return TRANSLATION_LOG_ERROR_CODES.providerAuth;
    case TRANSLATION_ERROR_CODES.TRANSLATION_PROVIDER_REQUEST_FAILED:
      return TRANSLATION_LOG_ERROR_CODES.providerRequestFailed;
    case TRANSLATION_ERROR_CODES.TRANSLATION_PROVIDER_TIMEOUT:
      return TRANSLATION_LOG_ERROR_CODES.providerTimeout;
    case TRANSLATION_ERROR_CODES.TRANSLATION_NETWORK_ERROR:
      return TRANSLATION_LOG_ERROR_CODES.networkError;
    case TRANSLATION_ERROR_CODES.TRANSLATION_INTERRUPTED:
      return TRANSLATION_LOG_ERROR_CODES.interrupted;
    default:
      return TRANSLATION_LOG_ERROR_CODES.unknownError;
  }
}

function validateTranslationRequest(request: TranslationGetRequest): void {
  if (
    !Number.isInteger(request.entryId)
    || request.entryId <= 0
    || !TRANSLATION_TARGET_LANGUAGES.includes(request.targetLanguage)
    || (request.useTerminology !== undefined && typeof request.useTerminology !== 'boolean')
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
