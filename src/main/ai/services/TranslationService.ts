import { performance } from 'node:perf_hooks';
import type { CleanedContent, ContentSegment } from '../../../shared/contracts/content.types';
import type { ShaleError } from '../../../shared/contracts/feed.ipc';
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
  TranslationPauseRequest,
  TranslationPauseResponse,
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
import type {
  ProviderFinishReason,
  ProviderTokenUsage,
  TextGenerationProvider,
} from '../provider/TextGenerationProvider';
import { sanitizeProviderTokenUsage } from '../provider/ProviderTokenUsage';
import {
  hasTranslatableText,
  isLikelyAlreadyTargetLanguage,
} from '../provider/TranslationLanguage';
import { TranslationBatchStreamParser, type TranslationBatchOutput } from '../provider/TranslationBatchStream';
import {
  TRANSLATION_COMPENSATION_PROTOCOLS,
  TranslationTextSlotStreamParser,
  type TranslationTextSlotOutput,
} from '../provider/TranslationTextSlotCompensation';
import {
  buildTranslationBatchPrompt,
  buildTranslationTextSlotCompensationPrompt,
  TRANSLATION_PROMPT_VERSION,
} from '../provider/TranslationPrompt';
import { renderExpertInstruction } from '../experts/ExpertCompiler';
import {
  createTranslationTextSlotPlan,
  parseTranslationOutput,
} from '../provider/TranslationHtml';
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
import {
  elapsedTranslationMilliseconds,
  logTranslationRecoveryCompleted,
  logTranslationMissingSegmentsDetected,
  logTranslationProviderRequestFailed,
  logTranslationRunCompleted,
  logTranslationRunFailed,
  logTranslationRunInterrupted,
  logTranslationRunStarted,
  TRANSLATION_LOG_ERROR_CODES,
  type TranslationOperationLogger,
  type TranslationContextWarningCode,
  type TranslationLogTrigger,
  type TranslationPreviousResultOutcome,
  type TranslationProviderRequestKind,
  type TranslationProviderResponseDiagnostics,
  type TranslationRunFailureStage,
  type TranslationStopReason,
} from './TranslationLogging';
import {
  TRANSLATION_OUTPUT_REASON_CODES,
  type TranslationOutputFailurePhase,
  type TranslationHtmlValidationReason,
  type TranslationOutputReasonCode,
  getTranslationOutputDiagnostic,
  hashTranslationSegmentId,
  invalidTranslationStructure,
} from '../TranslationOutputDiagnostics';
import {
  createProviderRequestId,
  createUsageAttemptId,
  NoopUsageRecorder,
  type UsageRecorderPort,
  type UsageRequestHandle,
} from './UsageRecorder';

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
  attemptId: string;
  abortController: AbortController;
  startedAt: number;
  terminalLogRecorded: boolean;
  trigger: TranslationLogTrigger;
  hadPreviousActiveResult: boolean;
  stopReason?: TranslationStopReason;
  contextWarningCode?: TranslationContextWarningCode;
  diagnostics: TranslationRunDiagnostics;
  sourceSegmentId?: string;
  priorityRanks: Map<string, number>;
  batches: TranslationBatchWork[];
  providerRequests: Set<ActiveProviderRequest>;
}

interface TranslationRunDiagnostics {
  providerRequestCount: number;
  batchRequestCount: number;
  compensationRequestCount: number;
  providerRequestSuccessCount: number;
  providerRequestFailureCount: number;
  missingSegmentCount: number;
  unresolvedMissingSegmentCount: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

interface ActiveProviderRequest {
  providerRequestId: number;
  requestKind: TranslationProviderRequestKind;
  segmentCount: number;
  startedAt: number;
  usageRequest: UsageRequestHandle;
  inputSegmentIds: string[];
  htmlValidationFailedSegmentIds: Set<string>;
  responseDiagnostics: MutableProviderResponseDiagnostics;
}

interface MutableProviderResponseDiagnostics {
  expectedSegmentCount: number;
  parsedSegmentCount: number;
  acceptedSegmentCount: number;
  missingSegmentCount: number;
  duplicateSegmentCount: number;
  unexpectedSegmentCount: number;
  malformedRecordCount: number;
  emptyTranslationCount: number;
  inputCharacters: number;
  outputCharacters: number;
  affectedSegmentIdHashes: Set<string>;
  finishReason?: ProviderFinishReason;
  failurePhase?: TranslationOutputFailurePhase;
  reasonCode?: TranslationOutputReasonCode;
  htmlValidationReason?: TranslationHtmlValidationReason;
  compensationProtocol?: 'text-slots';
  expectedTextSlotCount?: number;
  parsedTextSlotCount?: number;
  acceptedTextSlotCount?: number;
  missingTextSlotCount?: number;
  duplicateTextSlotCount?: number;
  unexpectedTextSlotCount?: number;
  malformedTextSlotCount?: number;
  emptyTextSlotCount?: number;
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
  providerProfileId: number;
  expert: ResolvedTranslationExpert;
  expertInstruction?: string;
  context?: TranslationContext;
  abortController: AbortController;
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
    private readonly logger?: TranslationOperationLogger,
    private readonly usageRecorder: UsageRecorderPort = new NoopUsageRecorder(),
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
    const activeCompatibleResult = this.translationStore.findActiveCompatibleResult(
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
    if (compatibleResult?.status === 'running') {
      return toState(compatibleResult, activeCompatibleResult);
    }
    if (
      compatibleResult?.status === 'failed'
      && compatibleResult.error?.code === TRANSLATION_ERROR_CODES.TRANSLATION_PAUSED
    ) {
      return toState(compatibleResult, activeCompatibleResult);
    }
    if (activeCompatibleResult) return toState(activeCompatibleResult);
    if (compatibleResult) return toState(compatibleResult);

    const activeResult = this.translationStore.findLatestActiveResult(
      request.entryId,
      request.sourceLanguage,
      request.targetLanguage,
      source.sourceContentHash,
      source.segmenterVersion,
    );
    if (activeResult) return toState(activeResult);

    return this.translationStore.findLatestResult(
      request.entryId,
      request.sourceLanguage,
      request.targetLanguage,
    )
      ? { state: 'stale' }
      : { state: 'idle' };
  }

  reconcileInterruptedRuns(): void {
    const startedAt = performance.now();
    const count = this.translationStore.reconcileInterruptedRuns();
    if (count <= 0) return;
    logTranslationRecoveryCompleted(this.logger, {
      durationMs: elapsedTranslationMilliseconds(startedAt),
      count,
      trigger: 'startup-recovery',
    });
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
    const activeResult = this.translationStore.findActiveCompatibleResult(
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

    if (this.activeRun) {
      if (
        !request.forceNew
        && this.activeRun.result.entryId === request.entryId
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
          result: this.activeRun.result,
          ...(activeResult ? { activeResult } : {}),
        };
      }
      throw new TranslationError(
        TRANSLATION_ERROR_CODES.TRANSLATION_BUSY,
        'Another Translation is already being generated. Wait for it to finish before starting another.',
        true,
      );
    }

    if (!request.forceNew && activeResult) {
      return { runId: activeResult.id, reused: true, result: activeResult };
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
    const isResuming = !request.forceNew
      && existingResult !== undefined
      && existingResult.status !== 'succeeded';
    const trigger: TranslationLogTrigger = request.forceNew
      ? 'force-new'
      : isResuming
        ? 'resume'
        : 'initial';
    const result = isResuming
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
    const startedAt = performance.now();
    this.activeRun = {
      result,
      attemptId: createUsageAttemptId(),
      abortController,
      startedAt,
      terminalLogRecorded: false,
      trigger,
      hadPreviousActiveResult: activeResult !== undefined,
      diagnostics: createTranslationRunDiagnostics(),
      priorityRanks: new Map(),
      batches: [],
      providerRequests: new Set(),
    };
    this.emit({
      type: 'started',
      runId: result.id,
      entryId: result.entryId,
      sourceLanguage: result.sourceLanguage,
      targetLanguage: result.targetLanguage,
    });
    logTranslationRunStarted(this.logger, {
      taskRunId: result.id,
      trigger,
      previousResultAtStart: activeResult ? 'retained' : 'none',
    });
    this.executeTimer = setTimeout(() => {
      this.executeTimer = undefined;
      void this.executeRun(result, {
        providerKind: profile.providerKind,
        baseUrl: profile.baseUrl,
        model: profile.model,
        apiKey,
        providerProfileId: profile.id,
        expert,
        abortController,
      });
    }, 0);
    return {
      runId: result.id,
      reused: false,
      result,
      ...(activeResult ? { activeResult } : {}),
    };
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

  pause(request: TranslationPauseRequest): TranslationPauseResponse {
    validateTranslationRequest(request);
    const activeRun = this.activeRun;
    if (
      !activeRun
      || activeRun.result.id !== request.runId
      || activeRun.result.entryId !== request.entryId
      || activeRun.result.sourceLanguage !== request.sourceLanguage
      || activeRun.result.targetLanguage !== request.targetLanguage
      || activeRun.result.terminologyPackVersion !== this.getTerminologyVersion(request)
      || activeRun.result.expertId !== this.resolveExpert(request.expertId).id
      || activeRun.result.smartContextEnabled !== (request.useSmartContext === true)
    ) {
      return { paused: false };
    }

    if (this.executeTimer) {
      clearTimeout(this.executeTimer);
      this.executeTimer = undefined;
    }
    activeRun.stopReason = 'paused';
    activeRun.abortController.abort();
    const pausedResult = this.translationStore.markRunPaused(
      activeRun.result.id,
      toTranslationIpcError(new TranslationError(
        TRANSLATION_ERROR_CODES.TRANSLATION_PAUSED,
        'Translation was paused.',
        true,
      )),
    );
    this.logRunInterrupted(activeRun, 'paused');
    this.activeRun = null;
    this.emit({
      type: 'paused',
      runId: pausedResult.id,
      entryId: pausedResult.entryId,
      sourceLanguage: pausedResult.sourceLanguage,
      targetLanguage: pausedResult.targetLanguage,
      result: pausedResult,
    });
    return { paused: true, result: pausedResult };
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
    activeRun.stopReason = 'shutdown';
    activeRun.abortController.abort();
    activeRun.providerRequests.forEach((providerRequest) => {
      this.usageRecorder.interrupt(
        providerRequest.usageRequest,
        undefined,
        TRANSLATION_ERROR_CODES.TRANSLATION_INTERRUPTED,
      );
    });
    this.translationStore.markRunFailed(
      activeRun.result.id,
      error,
      activeRun.sourceSegmentId,
    );
    this.logRunInterrupted(activeRun, 'shutdown');
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
    let stage: TranslationRunFailureStage = 'stream';
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
                providerProfileId: providerConfig.providerProfileId,
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
        const activeRun = this.activeRun;
        if (
          activeRun?.result.id === result.id
          && contextOutcome.warning?.code === TRANSLATION_ERROR_CODES.TRANSLATION_CONTEXT_UNAVAILABLE
        ) {
          activeRun.contextWarningCode = 'TRANSLATION_CONTEXT_UNAVAILABLE';
        }
      }

      const untranslatedSegments: TranslationSegment[] = [];
      for (const segment of result.segments) {
        if (segment.status === 'succeeded') continue;
        if (
          result.sourceLanguage === result.targetLanguage
          || !hasTranslatableText(segment.sourceText)
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
          sourceLanguage: result.sourceLanguage,
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
          sourceLanguage: result.sourceLanguage,
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
        sourceLanguage: result.sourceLanguage,
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
      if (
        failure.code === TRANSLATION_ERROR_CODES.TRANSLATION_INTERRUPTED
        && activeRun.stopReason
      ) {
        this.logRunInterrupted(activeRun, activeRun.stopReason);
      } else {
        this.logRunFailure(
          activeRun,
          stage,
          failure.code === TRANSLATION_ERROR_CODES.TRANSLATION_INTERRUPTED
            ? TRANSLATION_ERROR_CODES.TRANSLATION_UNKNOWN_ERROR
            : failure.code,
        );
      }
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
  ): Promise<SegmentTranslationFailure[]> {
    const active = this.activeRun;
    if (!active || active.result.id !== result.id) return [];
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
    const settledIds = new Set<string>();
    const successfullyTranslatedIds = new Set<string>();
    const segmentFailures: SegmentTranslationFailure[] = [];
    let latestBatchProviderRequest: ActiveProviderRequest | undefined;

    const persistOutputs = (
      outputs: TranslationBatchOutput[],
      providerRequest: ActiveProviderRequest,
    ): void => {
      providerRequest.responseDiagnostics.parsedSegmentCount += outputs.length;
      outputs.forEach((output) => {
        if (
          providerConfig.abortController.signal.aborted
          || this.activeRun?.result.id !== result.id
        ) {
          throw new TranslationError(
            TRANSLATION_ERROR_CODES.TRANSLATION_INTERRUPTED,
            'Translation generation was interrupted before completion.',
            true,
          );
        }
        if (settledIds.has(output.sourceSegmentId)) {
          recordAffectedSegmentId(
            providerRequest.responseDiagnostics,
            output.sourceSegmentId,
          );
          throw invalidBatchOutput(
            TRANSLATION_OUTPUT_REASON_CODES.segmentIdDuplicate,
            'segment-id',
            'The provider returned a duplicate Translation segment.',
          );
        }
        const input = inputs.find(({ segment }) =>
          segment.sourceSegmentId === output.sourceSegmentId);
        if (!input) {
          recordAffectedSegmentId(
            providerRequest.responseDiagnostics,
            output.sourceSegmentId,
          );
          throw invalidBatchOutput(
            TRANSLATION_OUTPUT_REASON_CODES.segmentIdUnexpected,
            'segment-id',
            'The provider returned an unknown Translation segment.',
          );
        }
        let parsed: ReturnType<typeof parseTranslationOutput>;
        try {
          parsed = parseTranslationOutput(
            input.segment.sourceHtml,
            JSON.stringify({
              translatedHtml: output.translatedHtml,
              appliedTermIds: output.appliedTermIds,
            }),
            input.terminologyCandidates,
            result.targetLanguage,
          );
        } catch (error) {
          recordAffectedSegmentId(
            providerRequest.responseDiagnostics,
            input.segment.sourceSegmentId,
          );
          if (isHtmlValidationFailure(error)) {
            providerRequest.htmlValidationFailedSegmentIds.add(
              input.segment.sourceSegmentId,
            );
          }
          throw error;
        }
        const completedSegment = this.translationStore.markSegmentSucceeded(
          result.id,
          input.segment.sourceSegmentId,
          parsed.translatedText,
          parsed.translatedHtml,
          parsed.terminologyMatches,
        );
        settledIds.add(output.sourceSegmentId);
        successfullyTranslatedIds.add(output.sourceSegmentId);
        providerRequest.responseDiagnostics.acceptedSegmentCount += 1;
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

    const streamPrompt = async (
      selectedInputs: SegmentTranslationInput[],
      requestKind: TranslationProviderRequestKind,
    ): Promise<ActiveProviderRequest> => {
      const prompt = buildPrompt(selectedInputs);
      const parser = new TranslationBatchStreamParser();
      const providerRequest = this.startProviderRequest(
        active,
        requestKind,
        selectedInputs,
        prompt.length,
        providerConfig,
      );
      latestBatchProviderRequest = providerRequest;
      let usage: ProviderTokenUsage | undefined;
      try {
        for await (const delta of this.provider.stream({
          providerKind: providerConfig.providerKind,
          baseUrl: providerConfig.baseUrl,
          model: providerConfig.model,
          apiKey: providerConfig.apiKey,
          prompt,
          signal: providerConfig.abortController.signal,
          requestUsage: true,
          onFinishReason: (finishReason) => {
            providerRequest.responseDiagnostics.finishReason = finishReason;
          },
          onUsage: (reportedUsage) => {
            usage = sanitizeProviderTokenUsage(reportedUsage);
          },
        })) {
          providerRequest.responseDiagnostics.outputCharacters += delta.length;
          let completedOutputs: ReturnType<TranslationBatchStreamParser['append']>;
          try {
            completedOutputs = parser.append(delta);
          } catch (error) {
            const outputError = toTranslationOutputError(
              error,
              TRANSLATION_OUTPUT_REASON_CODES.ndjsonSyntax,
              'stream',
              'The provider returned invalid Translation NDJSON.',
            );
            throw outputError;
          }
          persistOutputs(completedOutputs, providerRequest);
        }
        let finalOutputs: TranslationBatchOutput[];
        try {
          finalOutputs = parser.finish();
        } catch (error) {
          const fallbackReason = providerRequest.responseDiagnostics.finishReason === 'length'
            ? TRANSLATION_OUTPUT_REASON_CODES.providerLengthTruncated
            : TRANSLATION_OUTPUT_REASON_CODES.streamTailIncomplete;
          const outputError = fallbackReason === TRANSLATION_OUTPUT_REASON_CODES.providerLengthTruncated
            ? invalidBatchOutput(
                fallbackReason,
                'stream',
                'The provider output ended before the structured response was complete.',
              )
            : toTranslationOutputError(
                error,
                fallbackReason,
                'stream',
                'The provider returned invalid Translation NDJSON.',
              );
          throw outputError;
        }
        persistOutputs(finalOutputs, providerRequest);
        recordProviderRequestCompletion(
          providerRequest.responseDiagnostics,
          selectedInputs,
          settledIds,
        );
        this.completeProviderRequest(active, providerRequest, usage);
        return providerRequest;
      } catch (error) {
        recordProviderRequestMissingSegments(
          providerRequest.responseDiagnostics,
          selectedInputs,
          settledIds,
        );
        this.failProviderRequest(active, providerRequest, usage, error);
        throw error;
      }
    };

    const persistTextSlotCompensationResult = (
      input: SegmentTranslationInput,
      translatedText: string,
      translatedHtml: string,
      appliedTermIds: ReadonlySet<string>,
    ): void => {
      const terminologyMatches = input.terminologyCandidates.filter((candidate) =>
        appliedTermIds.has(`${candidate.sourceId}:${candidate.conceptId}`));
      const completedSegment = this.translationStore.markSegmentSucceeded(
        result.id,
        input.segment.sourceSegmentId,
        translatedText,
        translatedHtml,
        terminologyMatches,
      );
      settledIds.add(input.segment.sourceSegmentId);
      successfullyTranslatedIds.add(input.segment.sourceSegmentId);
      this.emit({
        type: 'segment-completed',
        runId: result.id,
        entryId: result.entryId,
        sourceLanguage: result.sourceLanguage,
        targetLanguage: result.targetLanguage,
        sourceSegmentId: input.segment.sourceSegmentId,
        segment: completedSegment,
      });
    };

    const streamTextSlotCompensation = async (
      input: SegmentTranslationInput,
    ): Promise<ActiveProviderRequest | undefined> => {
      const textSlotPlan = createTranslationTextSlotPlan(input.segment.sourceHtml);
      if (!textSlotPlan.textSlots.length) {
        const rebuilt = textSlotPlan.rebuild(new Map<string, string>(), result.targetLanguage);
        persistTextSlotCompensationResult(
          input,
          rebuilt.translatedText,
          rebuilt.translatedHtml,
          new Set<string>(),
        );
        return undefined;
      }

      const prompt = buildTranslationTextSlotCompensationPrompt({
        textSlots: [...textSlotPlan.textSlots],
        terminologyCandidates: input.terminologyCandidates,
        sourceLanguage: result.sourceLanguage,
        targetLanguage: result.targetLanguage,
        expertInstruction: providerConfig.expertInstruction,
        translationContext: providerConfig.context,
      });
      const parser = new TranslationTextSlotStreamParser();
      const providerRequest = this.startProviderRequest(
        active,
        'compensation',
        [input],
        prompt.length,
        providerConfig,
      );
      const diagnostics = providerRequest.responseDiagnostics;
      diagnostics.compensationProtocol = TRANSLATION_COMPENSATION_PROTOCOLS[0];
      diagnostics.expectedTextSlotCount = textSlotPlan.textSlots.length;
      diagnostics.parsedTextSlotCount = 0;
      diagnostics.acceptedTextSlotCount = 0;
      diagnostics.missingTextSlotCount = 0;
      diagnostics.duplicateTextSlotCount = 0;
      diagnostics.unexpectedTextSlotCount = 0;
      diagnostics.malformedTextSlotCount = 0;
      diagnostics.emptyTextSlotCount = 0;
      const expectedSlotIds = new Set(textSlotPlan.textSlots.map((slot) => slot.textSlotId));
      const acceptedSlotIds = new Set<string>();
      const translatedTextBySlotId = new Map<string, string>();
      const appliedTermIds = new Set<string>();
      let usage: ProviderTokenUsage | undefined;

      const persistSlotOutputs = (outputs: TranslationTextSlotOutput[]): void => {
        diagnostics.parsedTextSlotCount = (diagnostics.parsedTextSlotCount ?? 0) + outputs.length;
        outputs.forEach((output) => {
          if (
            providerConfig.abortController.signal.aborted
            || this.activeRun?.result.id !== result.id
          ) {
            throw new TranslationError(
              TRANSLATION_ERROR_CODES.TRANSLATION_INTERRUPTED,
              'Translation generation was interrupted before completion.',
              true,
            );
          }
          if (acceptedSlotIds.has(output.textSlotId)) {
            throw invalidBatchOutput(
              TRANSLATION_OUTPUT_REASON_CODES.textSlotIdDuplicate,
              'record',
              'The provider returned a duplicate Translation text slot.',
            );
          }
          if (!expectedSlotIds.has(output.textSlotId)) {
            throw invalidBatchOutput(
              TRANSLATION_OUTPUT_REASON_CODES.textSlotIdUnexpected,
              'record',
              'The provider returned an unknown Translation text slot.',
            );
          }
          acceptedSlotIds.add(output.textSlotId);
          translatedTextBySlotId.set(output.textSlotId, output.translatedText);
          output.appliedTermIds.forEach((termId) => appliedTermIds.add(termId));
          diagnostics.acceptedTextSlotCount = (diagnostics.acceptedTextSlotCount ?? 0) + 1;
        });
      };

      try {
        for await (const delta of this.provider.stream({
          providerKind: providerConfig.providerKind,
          baseUrl: providerConfig.baseUrl,
          model: providerConfig.model,
          apiKey: providerConfig.apiKey,
          prompt,
          signal: providerConfig.abortController.signal,
          requestUsage: true,
          onFinishReason: (finishReason) => {
            diagnostics.finishReason = finishReason;
          },
          onUsage: (reportedUsage) => {
            usage = sanitizeProviderTokenUsage(reportedUsage);
          },
        })) {
          diagnostics.outputCharacters += delta.length;
          let completedOutputs: ReturnType<TranslationTextSlotStreamParser['append']>;
          try {
            completedOutputs = parser.append(delta);
          } catch (error) {
            throw toTranslationOutputError(
              error,
              TRANSLATION_OUTPUT_REASON_CODES.ndjsonSyntax,
              'stream',
              'The provider returned invalid Translation text-slot NDJSON.',
            );
          }
          persistSlotOutputs(completedOutputs);
        }
        let finalOutputs: TranslationTextSlotOutput[];
        try {
          finalOutputs = parser.finish();
        } catch (error) {
          const fallbackReason = diagnostics.finishReason === 'length'
            ? TRANSLATION_OUTPUT_REASON_CODES.providerLengthTruncated
            : TRANSLATION_OUTPUT_REASON_CODES.streamTailIncomplete;
          throw fallbackReason === TRANSLATION_OUTPUT_REASON_CODES.providerLengthTruncated
            ? invalidBatchOutput(
                fallbackReason,
                'stream',
                'The provider output ended before the text-slot response was complete.',
              )
            : toTranslationOutputError(
                error,
                fallbackReason,
                'stream',
                'The provider returned invalid Translation text-slot NDJSON.',
              );
        }
        persistSlotOutputs(finalOutputs);
        if (acceptedSlotIds.size !== expectedSlotIds.size) {
          throw invalidBatchOutput(
            TRANSLATION_OUTPUT_REASON_CODES.expectedTextSlotMissing,
            'completion',
            'The provider omitted a Translation text slot.',
          );
        }
        const rebuilt = textSlotPlan.rebuild(translatedTextBySlotId, result.targetLanguage);
        persistTextSlotCompensationResult(
          input,
          rebuilt.translatedText,
          rebuilt.translatedHtml,
          appliedTermIds,
        );
        diagnostics.parsedSegmentCount += 1;
        diagnostics.acceptedSegmentCount += 1;
        this.completeProviderRequest(active, providerRequest, usage);
        return providerRequest;
      } catch (error) {
        recordTextSlotMissing(
          diagnostics,
          expectedSlotIds,
          acceptedSlotIds,
        );
        recordProviderRequestMissingSegments(
          diagnostics,
          [input],
          settledIds,
        );
        this.failProviderRequest(active, providerRequest, usage, error);
        throw error;
      }
    };

    const recoverMissingInput = async (
      sourceRequest: ActiveProviderRequest,
      input: SegmentTranslationInput,
    ): Promise<ActiveProviderRequest | undefined> => {
      if (sourceRequest.htmlValidationFailedSegmentIds.has(
        input.segment.sourceSegmentId,
      )) {
        return streamTextSlotCompensation(input);
      }

      try {
        return await streamPrompt([input], 'compensation');
      } catch (error) {
        if (!isHtmlValidationFailure(error)) throw error;

        // A segment omitted by the batch has no HTML response to classify up
        // front. If its one normal compensation attempt then changes the DOM,
        // escalate once to the source-DOM-backed text-slot protocol.
        return streamTextSlotCompensation(input);
      }
    };

    const compensateMissingInputs = async (providerRequest: ActiveProviderRequest): Promise<void> => {
      const missingInputs = inputs.filter(({ segment }) =>
        !settledIds.has(segment.sourceSegmentId));
      if (!missingInputs.length) return;
      const compensationInputs = missingInputs.slice(0, MAX_COMPENSATION_REQUESTS_PER_BATCH);
      active.diagnostics.missingSegmentCount += missingInputs.length;
      if (!compensationInputs.length || providerConfig.abortController.signal.aborted) {
        active.diagnostics.unresolvedMissingSegmentCount += missingInputs.filter(({ segment }) =>
          !successfullyTranslatedIds.has(segment.sourceSegmentId)).length;
        return;
      }
      logTranslationMissingSegmentsDetected(this.logger, {
        taskRunId: result.id,
        providerRequestId: providerRequest.providerRequestId,
        requestKind: providerRequest.requestKind,
        missingSegmentCount: missingInputs.length,
        responseDiagnostics: toProviderResponseDiagnostics(
          providerRequest.responseDiagnostics,
        ),
      });
      try {
        for (const missingInput of compensationInputs) {
          try {
            await recoverMissingInput(providerRequest, missingInput);
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
              sourceLanguage: result.sourceLanguage,
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
      } finally {
        active.diagnostics.unresolvedMissingSegmentCount += missingInputs.filter(({ segment }) =>
          !successfullyTranslatedIds.has(segment.sourceSegmentId)).length;
      }
      if (compensationInputs.length !== missingInputs.length) {
        throw invalidBatchOutput(
          TRANSLATION_OUTPUT_REASON_CODES.expectedSegmentMissing,
          'completion',
          'The provider omitted too many Translation segments.',
        );
      }
    };

    let batchRequest: ActiveProviderRequest;
    try {
      batchRequest = await streamPrompt(inputs, 'batch');
    } catch (error) {
      if (
        !isSegmentOutputError(toTranslationIpcError(error).code)
        || latestBatchProviderRequest === undefined
      ) {
        throw error;
      }
      await compensateMissingInputs(latestBatchProviderRequest);
      if (settledIds.size !== inputs.length) throw error;
      return segmentFailures;
    }

    await compensateMissingInputs(batchRequest);
    if (settledIds.size !== inputs.length) {
      throw invalidBatchOutput(
        TRANSLATION_OUTPUT_REASON_CODES.expectedSegmentMissing,
        'completion',
        'The provider omitted a Translation segment.',
      );
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

  private startProviderRequest(
    activeRun: ActiveTranslationRun,
    requestKind: TranslationProviderRequestKind,
    selectedInputs: SegmentTranslationInput[],
    inputCharacters: number,
    providerConfig: { providerProfileId: number; model: string },
  ): ActiveProviderRequest {
    const providerRequestId = createProviderRequestId();
    activeRun.diagnostics.providerRequestCount += 1;
    if (requestKind === 'batch') {
      activeRun.diagnostics.batchRequestCount += 1;
    } else {
      activeRun.diagnostics.compensationRequestCount += 1;
    }
    const request: ActiveProviderRequest = {
      providerRequestId,
      requestKind,
      segmentCount: selectedInputs.length,
      startedAt: performance.now(),
      inputSegmentIds: selectedInputs.map(({ segment }) => segment.sourceSegmentId),
      htmlValidationFailedSegmentIds: new Set(),
      responseDiagnostics: createProviderResponseDiagnostics(
        selectedInputs.length,
        inputCharacters,
      ),
      usageRequest: this.usageRecorder.start({
        providerRequestId,
        attemptId: activeRun.attemptId,
        taskType: 'translation',
        taskRunId: activeRun.result.id,
        providerProfileId: providerConfig.providerProfileId,
        model: providerConfig.model,
        requestKind,
      }),
    };
    activeRun.providerRequests.add(request);
    return request;
  }

  private completeProviderRequest(
    activeRun: ActiveTranslationRun,
    request: ActiveProviderRequest,
    usage: ProviderTokenUsage | undefined,
  ): void {
    const reportedUsage = toSafeProviderTokenUsage(usage);
    this.usageRecorder.complete(request.usageRequest, reportedUsage);
    activeRun.providerRequests.delete(request);
    this.recordProviderUsage(activeRun.diagnostics, reportedUsage);
    activeRun.diagnostics.providerRequestSuccessCount += 1;
  }

  private failProviderRequest(
    activeRun: ActiveTranslationRun,
    request: ActiveProviderRequest,
    usage: ProviderTokenUsage | undefined,
    error: unknown,
  ): void {
    const ipcError = toTranslationIpcError(error);
    recordProviderResponseFailure(
      request.responseDiagnostics,
      error,
    );
    const reportedUsage = toSafeProviderTokenUsage(usage);
    const requestStatus = ipcError.code === TRANSLATION_ERROR_CODES.TRANSLATION_INTERRUPTED
      ? 'interrupted'
      : 'failed';
    if (requestStatus === 'interrupted') {
      this.usageRecorder.interrupt(request.usageRequest, reportedUsage, ipcError.code);
    } else {
      this.usageRecorder.fail(request.usageRequest, ipcError.code, reportedUsage);
    }
    activeRun.providerRequests.delete(request);
    this.recordProviderUsage(activeRun.diagnostics, reportedUsage);
    activeRun.diagnostics.providerRequestFailureCount += 1;
    if (isExpectedProviderAbort(activeRun, error, ipcError.code)) return;
    logTranslationProviderRequestFailed(this.logger, {
      taskRunId: activeRun.result.id,
      providerRequestId: request.providerRequestId,
      requestKind: request.requestKind,
      segmentCount: request.segmentCount,
      durationMs: elapsedTranslationMilliseconds(request.startedAt),
      success: false,
      errorCode: toTranslationProviderRequestErrorCode(ipcError.code),
      responseDiagnostics: toProviderResponseDiagnostics(request.responseDiagnostics),
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
      unresolvedMissingSegmentCount: diagnostics.unresolvedMissingSegmentCount,
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
      trigger: activeRun.trigger,
      previousResultOutcome: this.getPreviousResultOutcome(activeRun, 'completed'),
      ...this.getContextDegradationFields(activeRun),
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
      trigger: activeRun.trigger,
      previousResultOutcome: this.getPreviousResultOutcome(activeRun, 'retained'),
      ...this.getContextDegradationFields(activeRun),
      ...this.getRunDiagnosticSummary(activeRun),
    });
  }

  private logRunInterrupted(
    activeRun: ActiveTranslationRun,
    stopReason: TranslationStopReason,
  ): void {
    if (activeRun.terminalLogRecorded) return;
    activeRun.terminalLogRecorded = true;
    logTranslationRunInterrupted(this.logger, {
      taskRunId: activeRun.result.id,
      durationMs: elapsedTranslationMilliseconds(activeRun.startedAt),
      success: false,
      stage: 'interrupt',
      errorCode: TRANSLATION_LOG_ERROR_CODES.interrupted,
      stopReason,
      trigger: activeRun.trigger,
      previousResultOutcome: this.getPreviousResultOutcome(activeRun, 'retained'),
      ...this.getContextDegradationFields(activeRun),
      ...this.getRunDiagnosticSummary(activeRun),
    });
  }

  private getPreviousResultOutcome(
    activeRun: ActiveTranslationRun,
    terminalOutcome: 'completed' | 'retained',
  ): TranslationPreviousResultOutcome {
    if (!activeRun.hadPreviousActiveResult) return 'none';
    return terminalOutcome === 'completed' ? 'replaced' : 'retained';
  }

  private getContextDegradationFields(
    activeRun: ActiveTranslationRun,
  ): Pick<
    import('./TranslationLogging').TranslationRunCompletedLogContext,
    'contextDegraded' | 'contextWarningCode'
  > {
    return activeRun.contextWarningCode === undefined
      ? {}
      : {
          contextDegraded: true,
          contextWarningCode: activeRun.contextWarningCode,
        };
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

function createTranslationRunDiagnostics(): TranslationRunDiagnostics {
  return {
    providerRequestCount: 0,
    batchRequestCount: 0,
    compensationRequestCount: 0,
    providerRequestSuccessCount: 0,
    providerRequestFailureCount: 0,
    missingSegmentCount: 0,
    unresolvedMissingSegmentCount: 0,
  };
}

function toSafeProviderTokenUsage(
  usage: ProviderTokenUsage | undefined,
): ProviderTokenUsage | undefined {
  return sanitizeProviderTokenUsage(usage);
}

function createProviderResponseDiagnostics(
  expectedSegmentCount: number,
  inputCharacters: number,
): MutableProviderResponseDiagnostics {
  return {
    expectedSegmentCount,
    parsedSegmentCount: 0,
    acceptedSegmentCount: 0,
    missingSegmentCount: 0,
    duplicateSegmentCount: 0,
    unexpectedSegmentCount: 0,
    malformedRecordCount: 0,
    emptyTranslationCount: 0,
    inputCharacters,
    outputCharacters: 0,
    affectedSegmentIdHashes: new Set(),
  };
}

function recordProviderRequestCompletion(
  diagnostics: MutableProviderResponseDiagnostics,
  selectedInputs: SegmentTranslationInput[],
  settledIds: ReadonlySet<string>,
): void {
  recordProviderRequestMissingSegments(diagnostics, selectedInputs, settledIds);
  if (!diagnostics.missingSegmentCount || diagnostics.reasonCode) return;
  const reasonCode = diagnostics.finishReason === 'length'
    ? TRANSLATION_OUTPUT_REASON_CODES.providerLengthTruncated
    : diagnostics.parsedSegmentCount === 0
      ? TRANSLATION_OUTPUT_REASON_CODES.responseEmpty
      : TRANSLATION_OUTPUT_REASON_CODES.expectedSegmentMissing;
  recordProviderResponseReason(diagnostics, reasonCode, 'completion');
}

function recordProviderRequestMissingSegments(
  diagnostics: MutableProviderResponseDiagnostics,
  selectedInputs: SegmentTranslationInput[],
  settledIds: ReadonlySet<string>,
): void {
  const missingSegmentIds = selectedInputs
    .map(({ segment }) => segment.sourceSegmentId)
    .filter((sourceSegmentId) => !settledIds.has(sourceSegmentId));
  diagnostics.missingSegmentCount = missingSegmentIds.length;
  missingSegmentIds.forEach((sourceSegmentId) =>
    recordAffectedSegmentId(diagnostics, sourceSegmentId));
}

function recordProviderResponseFailure(
  diagnostics: MutableProviderResponseDiagnostics,
  error: unknown,
): void {
  const outputDiagnostic = getTranslationOutputDiagnostic(error);
  if (outputDiagnostic) {
    recordProviderResponseReason(
      diagnostics,
      outputDiagnostic.reasonCode,
      outputDiagnostic.failurePhase,
    );
    diagnostics.htmlValidationReason = outputDiagnostic.htmlValidationReason;
    return;
  }
  const ipcError = toTranslationIpcError(error);
  if (ipcError.code === TRANSLATION_ERROR_CODES.TRANSLATION_EMPTY_OUTPUT) {
    recordProviderResponseReason(
      diagnostics,
      TRANSLATION_OUTPUT_REASON_CODES.responseEmpty,
      'stream',
    );
    return;
  }
  if (ipcError.code === TRANSLATION_ERROR_CODES.TRANSLATION_INVALID_STRUCTURE) {
    recordProviderResponseReason(
      diagnostics,
      TRANSLATION_OUTPUT_REASON_CODES.unclassified,
      'stream',
    );
  }
}

function recordProviderResponseReason(
  diagnostics: MutableProviderResponseDiagnostics,
  reasonCode: TranslationOutputReasonCode,
  failurePhase: TranslationOutputFailurePhase,
): void {
  diagnostics.reasonCode = reasonCode;
  diagnostics.failurePhase = failurePhase;
  const isTextSlotCompensation = diagnostics.compensationProtocol === 'text-slots';
  switch (reasonCode) {
    case TRANSLATION_OUTPUT_REASON_CODES.ndjsonSyntax:
    case TRANSLATION_OUTPUT_REASON_CODES.streamTailIncomplete:
    case TRANSLATION_OUTPUT_REASON_CODES.requiredFieldMissing:
    case TRANSLATION_OUTPUT_REASON_CODES.invalidFieldType:
    case TRANSLATION_OUTPUT_REASON_CODES.textSlotIdMissing:
      if (isTextSlotCompensation) {
        diagnostics.malformedTextSlotCount = (diagnostics.malformedTextSlotCount ?? 0) + 1;
      } else {
        diagnostics.malformedRecordCount += 1;
      }
      break;
    case TRANSLATION_OUTPUT_REASON_CODES.translatedHtmlEmpty:
    case TRANSLATION_OUTPUT_REASON_CODES.responseEmpty:
      diagnostics.emptyTranslationCount += 1;
      break;
    case TRANSLATION_OUTPUT_REASON_CODES.translatedTextEmpty:
      diagnostics.emptyTextSlotCount = (diagnostics.emptyTextSlotCount ?? 0) + 1;
      break;
    case TRANSLATION_OUTPUT_REASON_CODES.segmentIdDuplicate:
      diagnostics.duplicateSegmentCount += 1;
      break;
    case TRANSLATION_OUTPUT_REASON_CODES.segmentIdUnexpected:
      diagnostics.unexpectedSegmentCount += 1;
      break;
    case TRANSLATION_OUTPUT_REASON_CODES.textSlotIdDuplicate:
      diagnostics.duplicateTextSlotCount = (diagnostics.duplicateTextSlotCount ?? 0) + 1;
      break;
    case TRANSLATION_OUTPUT_REASON_CODES.textSlotIdUnexpected:
      diagnostics.unexpectedTextSlotCount = (diagnostics.unexpectedTextSlotCount ?? 0) + 1;
      break;
    default:
      break;
  }
}

function recordTextSlotMissing(
  diagnostics: MutableProviderResponseDiagnostics,
  expectedSlotIds: ReadonlySet<string>,
  acceptedSlotIds: ReadonlySet<string>,
): void {
  diagnostics.missingTextSlotCount = [...expectedSlotIds].filter((textSlotId) =>
    !acceptedSlotIds.has(textSlotId)).length;
}

function recordAffectedSegmentId(
  diagnostics: MutableProviderResponseDiagnostics,
  sourceSegmentId: string,
): void {
  if (diagnostics.affectedSegmentIdHashes.size >= 3) return;
  diagnostics.affectedSegmentIdHashes.add(hashTranslationSegmentId(sourceSegmentId));
}

function toProviderResponseDiagnostics(
  diagnostics: MutableProviderResponseDiagnostics,
): TranslationProviderResponseDiagnostics {
  const affectedSegmentIdHashes = [...diagnostics.affectedSegmentIdHashes];
  return {
    expectedSegmentCount: diagnostics.expectedSegmentCount,
    parsedSegmentCount: diagnostics.parsedSegmentCount,
    acceptedSegmentCount: diagnostics.acceptedSegmentCount,
    missingSegmentCount: diagnostics.missingSegmentCount,
    duplicateSegmentCount: diagnostics.duplicateSegmentCount,
    unexpectedSegmentCount: diagnostics.unexpectedSegmentCount,
    malformedRecordCount: diagnostics.malformedRecordCount,
    emptyTranslationCount: diagnostics.emptyTranslationCount,
    inputCharacters: diagnostics.inputCharacters,
    outputCharacters: diagnostics.outputCharacters,
    ...(diagnostics.finishReason === undefined
      ? {}
      : { finishReason: diagnostics.finishReason }),
    ...(diagnostics.failurePhase === undefined
      ? {}
      : { failurePhase: diagnostics.failurePhase }),
    ...(diagnostics.reasonCode === undefined
      ? {}
      : { reasonCode: diagnostics.reasonCode }),
    ...(diagnostics.htmlValidationReason === undefined
      ? {}
      : { htmlValidationReason: diagnostics.htmlValidationReason }),
    ...(diagnostics.compensationProtocol === undefined
      ? {}
      : { compensationProtocol: diagnostics.compensationProtocol }),
    ...(diagnostics.expectedTextSlotCount === undefined
      ? {}
      : { expectedTextSlotCount: diagnostics.expectedTextSlotCount }),
    ...(diagnostics.parsedTextSlotCount === undefined
      ? {}
      : { parsedTextSlotCount: diagnostics.parsedTextSlotCount }),
    ...(diagnostics.acceptedTextSlotCount === undefined
      ? {}
      : { acceptedTextSlotCount: diagnostics.acceptedTextSlotCount }),
    ...(diagnostics.missingTextSlotCount === undefined
      ? {}
      : { missingTextSlotCount: diagnostics.missingTextSlotCount }),
    ...(diagnostics.duplicateTextSlotCount === undefined
      ? {}
      : { duplicateTextSlotCount: diagnostics.duplicateTextSlotCount }),
    ...(diagnostics.unexpectedTextSlotCount === undefined
      ? {}
      : { unexpectedTextSlotCount: diagnostics.unexpectedTextSlotCount }),
    ...(diagnostics.malformedTextSlotCount === undefined
      ? {}
      : { malformedTextSlotCount: diagnostics.malformedTextSlotCount }),
    ...(diagnostics.emptyTextSlotCount === undefined
      ? {}
      : { emptyTextSlotCount: diagnostics.emptyTextSlotCount }),
    ...(affectedSegmentIdHashes.length ? { affectedSegmentIdHashes } : {}),
  };
}

function toTranslationOutputError(
  error: unknown,
  fallbackReasonCode: TranslationOutputReasonCode,
  failurePhase: TranslationOutputFailurePhase,
  message: string,
): TranslationError {
  if (error instanceof TranslationError) return error;
  return invalidTranslationStructure(fallbackReasonCode, failurePhase, message);
}

function isHtmlValidationFailure(error: unknown): boolean {
  const diagnostic = getTranslationOutputDiagnostic(error);
  return diagnostic?.reasonCode === TRANSLATION_OUTPUT_REASON_CODES.htmlStructureInvalid
    && diagnostic.failurePhase === 'html-validation';
}

function invalidBatchOutput(
  reasonCode: TranslationOutputReasonCode,
  failurePhase: TranslationOutputFailurePhase,
  message: string,
): TranslationError {
  return invalidTranslationStructure(
    reasonCode,
    failurePhase,
    message,
  );
}

function isSegmentOutputError(errorCode: string): boolean {
  return errorCode === TRANSLATION_ERROR_CODES.TRANSLATION_EMPTY_OUTPUT
    || errorCode === TRANSLATION_ERROR_CODES.TRANSLATION_INVALID_STRUCTURE;
}

function isExpectedProviderAbort(
  activeRun: ActiveTranslationRun,
  error: unknown,
  errorCode: string,
): boolean {
  if (!activeRun.abortController.signal.aborted) return false;
  if (errorCode === TRANSLATION_ERROR_CODES.TRANSLATION_INTERRUPTED) return true;
  return isAbortError(error);
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === 'AbortError' || candidate.code === 'ABORT_ERR';
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

function toState(
  result: TranslationResult,
  activeResult?: TranslationResult,
): TranslationState {
  const active = activeResult ? { activeResult } : {};
  if (result.status === 'running') return { state: 'running', result, ...active };
  if (result.status === 'failed') {
    return result.error?.code === TRANSLATION_ERROR_CODES.TRANSLATION_PAUSED
      ? { state: 'paused', result, ...active }
      : { state: 'failed', result, ...active };
  }
  return { state: 'succeeded', result, ...active };
}
