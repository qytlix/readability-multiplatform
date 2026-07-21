import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { CleanedContent } from '../../../shared/contracts/content.types';
import type {
  SummaryGenerateRequest,
  SummaryGenerateResponse,
  SummaryGetRequest,
  SummaryResult,
  SummaryRun,
  SummaryState,
  SummaryStreamEvent,
} from '../../../shared/contracts/summary.types';
import {
  SUMMARY_DETAIL_LEVELS,
  SUMMARY_TARGET_LANGUAGES,
} from '../../../shared/contracts/summary.types';
import {
  SUMMARY_ERROR_CODES,
  SummaryError,
  toSummaryIpcError,
} from '../../../shared/errors/summary.errors';
import type { ProviderProfileStore } from '../stores/ProviderProfileStore';
import type { SecretStore } from '../stores/SecretStore';
import { buildSummaryPrompt, SUMMARY_PROMPT_VERSION } from '../provider/SummaryPrompt';
import type { SummaryProvider } from '../provider/SummaryProvider';
import { SummaryStore } from '../stores/SummaryStore';
import {
  elapsedSummaryMilliseconds,
  logSummaryRecoveryCompleted,
  logSummaryRunCompleted,
  logSummaryRunFailed,
  logSummaryRunInterrupted,
  logSummaryRunStarted,
  SUMMARY_LOG_ERROR_CODES,
  type SummaryOperationLogger,
  type SummaryRunFailureStage,
} from './SummaryLogging';

export interface CleanedContentLookup {
  findByEntry(entryId: number): CleanedContent | undefined;
}

interface ActiveSummaryRun {
  run: SummaryRun;
  abortController: AbortController;
  startedAt: number;
  terminalLogRecorded: boolean;
}

export class SummaryService {
  private activeRun: ActiveSummaryRun | null = null;
  private readonly listeners = new Set<(event: SummaryStreamEvent) => void>();

  constructor(
    private readonly contentLookup: CleanedContentLookup,
    private readonly profileStore: ProviderProfileStore,
    private readonly secretStore: SecretStore,
    private readonly summaryStore: SummaryStore,
    private readonly provider: SummaryProvider,
    private readonly logger?: SummaryOperationLogger,
  ) {}

  subscribe(listener: (event: SummaryStreamEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(request: SummaryGetRequest): SummaryState {
    validateSummaryRequest(request);
    const runningRun = this.summaryStore.findRunningRun(
      request.entryId,
      request.targetLanguage,
      request.detailLevel,
    );
    if (runningRun) return { state: 'running', run: runningRun };

    const existingResult = this.summaryStore.findResult(
      request.entryId,
      request.targetLanguage,
      request.detailLevel,
    );
    if (existingResult) {
      const content = this.contentLookup.findByEntry(request.entryId);
      const freshness = hasUsableMarkdown(content)
        && hashMarkdown(content.markdown) === existingResult.inputMarkdownHash
        ? 'fresh'
        : 'stale';
      return { state: 'succeeded', result: existingResult, freshness };
    }

    const failedRun = this.summaryStore.findLatestFailedRun(
      request.entryId,
      request.targetLanguage,
      request.detailLevel,
    );
    return failedRun ? { state: 'failed', run: failedRun } : { state: 'idle' };
  }

  reconcileInterruptedRuns(): void {
    const startedAt = performance.now();
    const count = this.summaryStore.reconcileInterruptedRuns();
    logSummaryRecoveryCompleted(this.logger, {
      durationMs: elapsedSummaryMilliseconds(startedAt),
      count,
    });
  }

  generate(request: SummaryGenerateRequest): SummaryGenerateResponse {
    validateSummaryRequest(request);
    const content = this.contentLookup.findByEntry(request.entryId);
    if (!hasUsableMarkdown(content)) {
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_CONTENT_UNAVAILABLE,
        'Summary needs successfully cleaned article Markdown. Try opening the article again first.',
        true,
      );
    }
    const inputMarkdownHash = hashMarkdown(content.markdown);
    const existingResult = this.summaryStore.findResult(
      request.entryId,
      request.targetLanguage,
      request.detailLevel,
    );
    if (existingResult?.inputMarkdownHash === inputMarkdownHash) {
      return { runId: existingResult.runId, reused: true };
    }

    if (this.activeRun) {
      if (
        this.activeRun.run.entryId === request.entryId
        && this.activeRun.run.targetLanguage === request.targetLanguage
        && this.activeRun.run.detailLevel === request.detailLevel
      ) {
        return { runId: this.activeRun.run.id, reused: true };
      }
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_BUSY,
        'Another Summary is already being generated. Wait for it to finish before starting another.',
        true,
      );
    }

    const profile = this.profileStore.findActiveWithSecret();
    if (!profile) {
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_NOT_CONFIGURED,
        'Configure a Summary provider before generating a Summary.',
        false,
      );
    }

    const apiKey = this.secretStore.read(profile.apiKeyRef);
    const run = this.summaryStore.createRun({
      entryId: request.entryId,
      providerProfileId: profile.id,
      targetLanguage: request.targetLanguage,
      detailLevel: request.detailLevel,
      inputMarkdownHash,
    });
    const abortController = new AbortController();
    const startedAt = performance.now();
    this.activeRun = {
      run,
      abortController,
      startedAt,
      terminalLogRecorded: false,
    };
    this.emit({
      type: 'started',
      runId: run.id,
      entryId: run.entryId,
      targetLanguage: run.targetLanguage,
      detailLevel: run.detailLevel,
    });
    logSummaryRunStarted(this.logger, { taskRunId: run.id });
    void this.executeRun(run, content.markdown, inputMarkdownHash, {
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey,
      abortController,
    });
    return { runId: run.id, reused: false };
  }

  abortActiveRun(): void {
    if (!this.activeRun) return;
    const activeRun = this.activeRun;
    const error = toSummaryIpcError(
      new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_INTERRUPTED,
        'Summary generation was interrupted before completion.',
        true,
      ),
    );
    activeRun.abortController.abort();
    this.summaryStore.markRunFailed(activeRun.run.id, error);
    this.logRunInterrupted(activeRun);
    this.emit({
      type: 'failed',
      runId: activeRun.run.id,
      entryId: activeRun.run.entryId,
      targetLanguage: activeRun.run.targetLanguage,
      detailLevel: activeRun.run.detailLevel,
      error,
    });
    this.activeRun = null;
  }

  private async executeRun(
    run: SummaryRun,
    markdown: string,
    inputMarkdownHash: string,
    providerConfig: {
      baseUrl: string;
      model: string;
      apiKey: string;
      abortController: AbortController;
    },
  ): Promise<void> {
    let stage: SummaryRunFailureStage = 'stream';
    try {
      const prompt = buildSummaryPrompt({
        articleMarkdown: markdown,
        targetLanguage: run.targetLanguage,
        detailLevel: run.detailLevel,
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
          type: 'delta',
          runId: run.id,
          entryId: run.entryId,
          targetLanguage: run.targetLanguage,
          detailLevel: run.detailLevel,
          text: delta,
        });
      }

      if (!output.trim()) {
        throw new SummaryError(
          SUMMARY_ERROR_CODES.SUMMARY_EMPTY_OUTPUT,
          'The provider returned an empty Summary.',
          true,
        );
      }

      stage = 'persist';
      const result = this.summaryStore.markRunSucceededWithResult({
        runId: run.id,
        entryId: run.entryId,
        targetLanguage: run.targetLanguage,
        detailLevel: run.detailLevel,
        inputMarkdownHash,
        promptVersion: SUMMARY_PROMPT_VERSION,
        content: output.trim(),
      });
      const activeRun = this.activeRun;
      if (activeRun?.run.id === run.id) {
        this.logRunCompleted(activeRun);
      }
      this.emitCompleted(run, result);
    } catch (error) {
      const activeRun = this.activeRun;
      if (
        !activeRun
        || activeRun.run.id !== run.id
        || activeRun.terminalLogRecorded
      ) {
        return;
      }
      const failure = toSummaryIpcError(error);
      this.summaryStore.markRunFailed(run.id, failure);
      if (failure.code === SUMMARY_ERROR_CODES.SUMMARY_INTERRUPTED) {
        this.logRunInterrupted(activeRun);
      } else {
        this.logRunFailed(activeRun, stage, failure.code);
      }
      this.emit({
        type: 'failed',
        runId: run.id,
        entryId: run.entryId,
        targetLanguage: run.targetLanguage,
        detailLevel: run.detailLevel,
        error: failure,
      });
    } finally {
      if (this.activeRun?.run.id === run.id) this.activeRun = null;
    }
  }

  private emitCompleted(run: SummaryRun, result: SummaryResult): void {
    this.emit({
      type: 'completed',
      runId: run.id,
      entryId: run.entryId,
      targetLanguage: run.targetLanguage,
      detailLevel: run.detailLevel,
      result,
    });
  }

  private logRunInterrupted(activeRun: ActiveSummaryRun): void {
    if (activeRun.terminalLogRecorded) return;
    activeRun.terminalLogRecorded = true;
    logSummaryRunInterrupted(this.logger, {
      taskRunId: activeRun.run.id,
      durationMs: elapsedSummaryMilliseconds(activeRun.startedAt),
      success: false,
      stage: 'interrupt',
      errorCode: SUMMARY_LOG_ERROR_CODES.interrupted,
    });
  }

  private logRunCompleted(activeRun: ActiveSummaryRun): void {
    if (activeRun.terminalLogRecorded) return;
    activeRun.terminalLogRecorded = true;
    logSummaryRunCompleted(this.logger, {
      taskRunId: activeRun.run.id,
      durationMs: elapsedSummaryMilliseconds(activeRun.startedAt),
      success: true,
    });
  }

  private logRunFailed(
    activeRun: ActiveSummaryRun,
    stage: SummaryRunFailureStage,
    errorCode: string,
  ): void {
    if (activeRun.terminalLogRecorded) return;
    activeRun.terminalLogRecorded = true;
    logSummaryRunFailed(this.logger, {
      taskRunId: activeRun.run.id,
      durationMs: elapsedSummaryMilliseconds(activeRun.startedAt),
      success: false,
      stage,
      errorCode: toSummaryRunFailureErrorCode(stage, errorCode),
    });
  }

  private emit(event: SummaryStreamEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}

function toSummaryRunFailureErrorCode(
  stage: SummaryRunFailureStage,
  errorCode: string,
): typeof SUMMARY_LOG_ERROR_CODES[keyof typeof SUMMARY_LOG_ERROR_CODES] {
  if (stage === 'persist') return SUMMARY_LOG_ERROR_CODES.unknownError;

  switch (errorCode) {
    case SUMMARY_ERROR_CODES.SUMMARY_EMPTY_OUTPUT:
      return SUMMARY_LOG_ERROR_CODES.emptyOutput;
    case SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_AUTH:
      return SUMMARY_LOG_ERROR_CODES.providerAuth;
    case SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_REQUEST_FAILED:
      return SUMMARY_LOG_ERROR_CODES.providerRequestFailed;
    case SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_TIMEOUT:
      return SUMMARY_LOG_ERROR_CODES.providerTimeout;
    case SUMMARY_ERROR_CODES.SUMMARY_NETWORK_ERROR:
      return SUMMARY_LOG_ERROR_CODES.networkError;
    default:
      return SUMMARY_LOG_ERROR_CODES.unknownError;
  }
}

function validateSummaryRequest(request: SummaryGetRequest): void {
  if (
    !Number.isInteger(request.entryId)
    || request.entryId <= 0
    || !SUMMARY_TARGET_LANGUAGES.includes(request.targetLanguage)
    || !SUMMARY_DETAIL_LEVELS.includes(request.detailLevel)
  ) {
    throw new SummaryError(
      SUMMARY_ERROR_CODES.SUMMARY_INVALID_REQUEST,
      'The Summary request is invalid.',
      false,
    );
  }
}

function hasUsableMarkdown(content: CleanedContent | undefined): content is CleanedContent {
  return Boolean(
    content
    && content.pipelineStatus === 'success'
    && content.markdown.trim(),
  );
}

export function hashMarkdown(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex');
}
