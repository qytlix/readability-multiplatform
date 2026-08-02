import { createHash } from 'node:crypto';
import type { CleanedContent } from '../../../shared/contracts/content.types';
import {
  CHAT_OPERATION_ID_MAX_LENGTH,
  CHAT_PROMPT_VERSION,
  CHAT_SELECTION_LIMITS,
  type ChatCancelRequest,
  type ChatGetRequest,
  type ChatRegenerateRequest,
  type ChatRun,
  type ChatRunResponse,
  type ChatRetryRequest,
  type ChatSendRequest,
  type ChatState,
  type ChatStreamEvent,
} from '../../../shared/contracts/chat.types';
import {
  CHAT_ERROR_CODES,
  ChatError,
  toChatIpcError,
} from '../../../shared/errors/chat.errors';
import {
  SUMMARY_ERROR_CODES,
  SummaryError,
} from '../../../shared/errors/summary.errors';
import type {
  ProviderContentPart,
  ProviderTokenUsage,
  TextGenerationProvider,
  TextGenerationProviderRequest,
} from '../provider/TextGenerationProvider';
import { sanitizeProviderTokenUsage } from '../provider/ProviderTokenUsage';
import type {
  ActiveProviderProfile,
  ProviderProfileStore,
} from '../stores/ProviderProfileStore';
import type { SecretStore } from '../stores/SecretStore';
import {
  ChatStore,
  type StoredChatAttachment,
} from '../stores/ChatStore';
import {
  createProviderRequestId,
  createUsageAttemptId,
  NoopUsageRecorder,
  type UsageRecorderPort,
  type UsageRequestHandle,
} from './UsageRecorder';
import type {
  ArticleContextService,
  PreparedArticleContext,
} from './ArticleContextService';
import {
  DEFAULT_CHAT_CONTEXT_WINDOW_TOKENS,
  DEFAULT_CHAT_RESPONSE_RESERVE_TOKENS,
} from './ArticleContextBudget';
import {
  CHAT_LOG_ERROR_CODES,
  createChatFailureTerminal,
  elapsedChatMilliseconds,
  logChatAttachmentOperationFailed,
  logChatRunFailed,
  logChatSessionPersistenceFailed,
  type ChatAttachmentFailureStage,
  type ChatFailureTerminal,
  type ChatOperationLogger,
  type ChatRunFailureStage,
  type ChatRunLogOperation,
  type ChatSessionFailureStage,
} from './ChatLogging';
import { performance } from 'node:perf_hooks';

const CHAT_PROVIDER_RETRY_DELAYS_MS = [1_000, 3_000, 7_000] as const;
const CHAT_PROVIDER_TIMEOUT_RETRY_DELAYS_MS = [1_000] as const;

export interface ChatContentLookup {
  findByEntry(entryId: number): CleanedContent | undefined;
}

export type ChatProfileLookup = Pick<ProviderProfileStore, 'findActiveWithSecret'>;
export type ChatSecretLookup = Pick<SecretStore, 'read'>;
export type ArticleContextPreparationPort = Pick<ArticleContextService, 'prepare'>;

export interface ChatAttachmentContentLoader {
  readImage(attachment: StoredChatAttachment): Uint8Array;
}

interface ActiveChatRun {
  operationId: string;
  run: ChatRun;
  entryId: number;
  abortController: AbortController;
  usageHandle?: UsageRequestHandle;
  phase: 'context-preparation' | 'provider';
  runIsActive: boolean;
  cancelRequested: boolean;
  startedAt: number;
  operation: ChatRunLogOperation;
  failureTerminal: ChatFailureTerminal;
}

type ChatExecutionFailure =
  | { kind: 'run'; stage: ChatRunFailureStage }
  | { kind: 'session'; stage: ChatSessionFailureStage }
  | { kind: 'attachment'; stage: ChatAttachmentFailureStage };

export class ChatService {
  private activeRun: ActiveChatRun | null = null;
  private readonly listeners = new Set<(event: ChatStreamEvent) => void>();

  constructor(
    private readonly contentLookup: ChatContentLookup,
    private readonly profileLookup: ChatProfileLookup,
    private readonly secretLookup: ChatSecretLookup,
    private readonly chatStore: ChatStore,
    private readonly contextService: ArticleContextPreparationPort,
    private readonly provider: TextGenerationProvider,
    private readonly attachmentLoader?: ChatAttachmentContentLoader,
    private readonly usageRecorder: UsageRecorderPort = new NoopUsageRecorder(),
    private readonly logger?: ChatOperationLogger,
  ) {}

  subscribe(listener: (event: ChatStreamEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(request: ChatGetRequest): ChatState {
    validateEntryId(request.entryId);
    const startedAt = performance.now();
    const terminal = createChatFailureTerminal();
    try {
      const content = this.requireContent(request.entryId);
      const sourceContentHash = content.sourceContentHash
        ?? hashChatInput(content.markdown);
      const thread = this.chatStore.findOrCreateThread(
        request.entryId,
        sourceContentHash,
        CHAT_PROMPT_VERSION,
      );
      const messages = this.chatStore.listMessages(thread.id);
      const draftAttachments = this.chatStore.listDraftAttachments(thread.id);
      const latestRun = this.chatStore.findLatestRunForThread(thread.id);
      if (latestRun?.status === 'running') {
        return {
          state: 'running',
          thread,
          messages,
          draftAttachments,
          run: latestRun,
        };
      }
      if (latestRun?.status === 'failed' || latestRun?.status === 'interrupted') {
        return {
          state: latestRun.status,
          thread,
          messages,
          draftAttachments,
          run: latestRun,
        };
      }
      return { state: 'idle', thread, messages, draftAttachments };
    } catch (error) {
      if (shouldRecordChatSystemFailure(error)) {
        logChatSessionPersistenceFailed(this.logger, terminal, {
          operation: 'load',
          finalFailureStage: 'session-load',
          durationMs: elapsedChatMilliseconds(startedAt),
          success: false,
          errorCode: CHAT_LOG_ERROR_CODES.sessionPersistenceFailed,
        });
      }
      throw error;
    }
  }

  async send(request: ChatSendRequest): Promise<ChatRunResponse> {
    validateSendRequest(request);
    if (this.activeRun) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_BUSY,
        'Another Article Chat answer is already being generated.',
        true,
      );
    }
    const requestStartedAt = performance.now();
    const failureTerminal = createChatFailureTerminal();
    const operation = 'send' as const;
    let persistenceStage: ChatSessionFailureStage | undefined;
    let taskRunId: number | undefined;
    let operationRun: ActiveChatRun | undefined;
    try {
      const content = this.requireContent(request.entryId);
      const sourceContentHash = content.sourceContentHash
        ?? hashChatInput(content.markdown);
      const profile = this.requireProfile();
      persistenceStage = 'thread-load-or-create';
      const thread = this.chatStore.findOrCreateThread(
        request.entryId,
        sourceContentHash,
        CHAT_PROMPT_VERSION,
      );
      persistenceStage = 'session-load';
      const attachments = request.attachmentIds.map((attachmentId) =>
        this.requireAttachment(attachmentId, thread.id));
      persistenceStage = undefined;
      if (
        attachments.some(({ kind }) => kind === 'image')
        && !profile.chatSupportsImages
      ) {
        throw new ChatError(
          CHAT_ERROR_CODES.CHAT_IMAGE_UNSUPPORTED,
          'The configured AI Chat model is not enabled for image input.',
          false,
        );
      }
      persistenceStage = 'session-load';
      const history = this.chatStore.listMessages(thread.id);
      persistenceStage = undefined;
      const attemptId = createUsageAttemptId();
      persistenceStage = 'run-reserve';
      const created = this.chatStore.createRunWithMessages({
        threadId: thread.id,
        question: request.question.trim(),
        selection: request.selection,
        providerProfileId: profile.id,
        providerKind: profile.chatProviderKind,
        model: profile.chatModel,
        promptVersion: CHAT_PROMPT_VERSION,
        // The run is reserved before article-map Provider work so every
        // request can be attributed to a durable Chat identity.
        contextMode: 'article-map',
        articleContentHash: sourceContentHash,
        inputContentHash: hashChatInput([
          sourceContentHash,
          request.question.trim(),
          ...attachments.map(({ contentHash }) => contentHash),
        ].join('\n')),
      });
      taskRunId = created.run.id;
      persistenceStage = 'attachment-link';
      this.chatStore.linkAttachments(
        created.userMessage.id,
        request.attachmentIds,
      );
      persistenceStage = undefined;
      const abortController = new AbortController();
      operationRun = {
        operationId: request.operationId,
        run: created.run,
        entryId: request.entryId,
        abortController,
        phase: 'context-preparation',
        runIsActive: true,
        cancelRequested: false,
        startedAt: requestStartedAt,
        operation,
        failureTerminal,
      };
      this.activeRun = operationRun;
      let prepared: PreparedArticleContext;
      try {
        prepared = await this.contextService.prepare({
          signal: abortController.signal,
          source: {
            entryId: request.entryId,
            title: content.readerTitle,
            sourceUrl: content.sourceUrl,
            markdown: content.markdown,
            sourceContentHash,
            segments: content.segments ?? [],
          },
          history,
          question: request.question.trim(),
          selection: request.selection,
          textAttachments: attachments.flatMap((attachment) => (
            attachment.kind === 'text' && attachment.textContent !== undefined
              ? [{
                  id: attachment.id,
                  displayName: attachment.displayName,
                  mimeType: attachment.mimeType,
                  textContent: attachment.textContent,
                }]
              : []
          )),
          analysisModelFamily: `${profile.chatProviderKind}:${profile.chatModel}`,
          analysisUsage: {
            attemptId,
            taskRunId: created.run.id,
            providerProfileId: profile.id,
            model: profile.chatModel,
          },
          contextWindowTokens: DEFAULT_CHAT_CONTEXT_WINDOW_TOKENS,
          responseReserveTokens: DEFAULT_CHAT_RESPONSE_RESERVE_TOKENS,
        });
      } catch (error) {
        const preparationError = normalizeChatOperationError(
          error,
          abortController.signal,
        );
        if (isChatInterruption(preparationError)) {
          this.finishPreparingRunInterruption(operationRun);
          throw preparationError;
        }
        const failure = toChatIpcError(preparationError);
        try {
          this.chatStore.markRunFailed(created.run.id, failure);
        } catch (persistenceError) {
          logChatSessionPersistenceFailed(this.logger, failureTerminal, {
            operation,
            finalFailureStage: 'run-fail',
            durationMs: elapsedChatMilliseconds(requestStartedAt),
            success: false,
            errorCode: CHAT_LOG_ERROR_CODES.sessionPersistenceFailed,
            taskRunId: created.run.id,
          });
          throw persistenceError;
        }
        this.logRunFailure(
          failureTerminal,
          operation,
          created.run.id,
          requestStartedAt,
          'context-preparation',
          preparationError,
        );
        throw preparationError;
      }
      this.assertOperationCanContinue(operationRun);
      const inputContentHash = hashChatInput([
        prepared.articleReference,
        prepared.historyReference,
        request.question.trim(),
        ...attachments.map(({ contentHash }) => contentHash),
      ].join('\n'));
      persistenceStage = 'context-finalize';
      this.assertOperationCanContinue(operationRun);
      const finalizedRun = this.chatStore.finalizeRunContext(
        created.run.id,
        prepared.mode,
        inputContentHash,
      );
      operationRun.run = finalizedRun;
      persistenceStage = undefined;
      let startupFailure: ChatExecutionFailure = {
        kind: 'run',
        stage: 'event-listener',
      };
      try {
        this.emit({
          type: 'started',
          runId: finalizedRun.id,
          threadId: thread.id,
          entryId: request.entryId,
          messageId: created.assistantMessage.id,
          contextMode: prepared.mode,
        });
        startupFailure = { kind: 'run', stage: 'provider' };
        const apiKey = this.secretLookup.read(profile.chatApiKeyRef);
        this.assertOperationCanContinue(operationRun);
        void this.executeRun(
          finalizedRun,
          request.entryId,
          prepared,
          attachments,
          request.question.trim(),
          profile,
          apiKey,
          abortController,
          attemptId,
        );
      } catch (error) {
        const startupError = normalizeChatOperationError(
          error,
          abortController.signal,
        );
        if (isChatInterruption(startupError)) {
          this.finishPreparingRunInterruption(operationRun);
        } else {
          this.finishActiveRunFailure(
            this.activeRun,
            startupError,
            startupFailure,
            undefined,
            false,
          );
        }
        throw startupError;
      }
      return {
        runId: finalizedRun.id,
        threadId: thread.id,
        userMessageId: created.userMessage.id,
        assistantMessageId: created.assistantMessage.id,
        reused: false,
      };
    } catch (error) {
      const operationError = operationRun
        ? normalizeChatOperationError(error, operationRun.abortController.signal)
        : error;
      if (operationRun && isChatInterruption(operationError)) {
        this.finishPreparingRunInterruption(operationRun);
      }
      if (persistenceStage && shouldRecordChatSystemFailure(operationError)) {
        logChatSessionPersistenceFailed(this.logger, failureTerminal, {
          operation,
          finalFailureStage: persistenceStage,
          durationMs: elapsedChatMilliseconds(requestStartedAt),
          success: false,
          errorCode: CHAT_LOG_ERROR_CODES.sessionPersistenceFailed,
          ...(taskRunId === undefined ? {} : { taskRunId }),
        });
      }
      throw operationError;
    } finally {
      if (
        operationRun
        && this.activeRun === operationRun
        && operationRun.phase === 'context-preparation'
      ) {
        this.activeRun = null;
      }
    }
  }

  cancel(request: ChatCancelRequest): void {
    const hasRunId = request.runId !== undefined;
    const hasOperationId = request.operationId !== undefined;
    if (
      hasRunId === hasOperationId
      || (
        hasRunId
        && (!Number.isInteger(request.runId) || (request.runId ?? 0) <= 0)
      )
      || (hasOperationId && !isValidOperationId(request.operationId))
    ) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_INVALID_REQUEST,
        'The Article Chat cancel request is invalid.',
        false,
      );
    }
    const active = this.activeRun;
    const matches = active && (
      hasRunId
        ? active.run.id === request.runId
        : active.operationId === request.operationId
    );
    if (!active || !matches) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_INTERRUPTED,
        'The Article Chat run is no longer active.',
        false,
      );
    }
    this.interruptActiveRun();
  }

  async retry(request: ChatRetryRequest): Promise<ChatRunResponse> {
    if (
      !isValidOperationId(request.operationId)
      || !Number.isInteger(request.runId)
      || request.runId <= 0
      || this.activeRun
    ) {
      throw new ChatError(
        this.activeRun
          ? CHAT_ERROR_CODES.CHAT_BUSY
          : CHAT_ERROR_CODES.CHAT_INVALID_REQUEST,
        this.activeRun
          ? 'Another Article Chat answer is already being generated.'
          : 'The Article Chat retry request is invalid.',
        Boolean(this.activeRun),
      );
    }
    const requestStartedAt = performance.now();
    const failureTerminal = createChatFailureTerminal();
    const operation = 'retry' as const;
    let persistenceStage: ChatSessionFailureStage | undefined = 'session-load';
    let previousRun: ChatRun | undefined;
    try {
      previousRun = this.chatStore.findRunById(request.runId);
    } catch (error) {
      if (shouldRecordChatSystemFailure(error)) {
        logChatSessionPersistenceFailed(this.logger, failureTerminal, {
          operation,
          finalFailureStage: 'session-load',
          durationMs: elapsedChatMilliseconds(requestStartedAt),
          success: false,
          errorCode: CHAT_LOG_ERROR_CODES.sessionPersistenceFailed,
          taskRunId: request.runId,
        });
      }
      throw error;
    }
    if (
      !previousRun
      || (
        previousRun.status !== 'failed'
        && previousRun.status !== 'interrupted'
      )
    ) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_INVALID_REQUEST,
        'Only a failed or interrupted Article Chat answer can be retried.',
        false,
      );
    }
    let thread: ReturnType<ChatStore['findThreadById']>;
    let userMessage: ReturnType<ChatStore['findMessageById']>;
    try {
      thread = this.chatStore.findThreadById(previousRun.threadId);
      userMessage = this.chatStore.findMessageById(previousRun.userMessageId);
    } catch (error) {
      if (shouldRecordChatSystemFailure(error)) {
        logChatSessionPersistenceFailed(this.logger, failureTerminal, {
          operation,
          finalFailureStage: 'session-load',
          durationMs: elapsedChatMilliseconds(requestStartedAt),
          success: false,
          errorCode: CHAT_LOG_ERROR_CODES.sessionPersistenceFailed,
          taskRunId: request.runId,
        });
      }
      throw error;
    }
    if (!thread || !userMessage) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_INVALID_REQUEST,
        'The Article Chat retry source is unavailable.',
        false,
      );
    }

    let operationRun: ActiveChatRun | undefined;
    try {
      persistenceStage = undefined;
      const content = this.requireContent(thread.entryId);
      const currentHash = content.sourceContentHash ?? hashChatInput(content.markdown);
      if (currentHash !== thread.sourceContentHash) {
        throw new ChatError(
          CHAT_ERROR_CODES.CHAT_CONTENT_UNAVAILABLE,
          'The article changed after this answer was created. Ask again in the new conversation.',
          false,
        );
      }
      const profile = this.requireProfile();
      persistenceStage = 'session-load';
      const attachments = userMessage.attachments.map(({ id }) =>
        this.requireAttachment(id, thread.id));
      persistenceStage = undefined;
      if (
        attachments.some(({ kind }) => kind === 'image')
        && !profile.chatSupportsImages
      ) {
        throw new ChatError(
          CHAT_ERROR_CODES.CHAT_IMAGE_UNSUPPORTED,
          'The configured AI Chat model is not enabled for image input.',
          false,
        );
      }
      persistenceStage = 'session-load';
      const history = this.chatStore.listMessages(thread.id)
        .filter(({ id }) => id < userMessage.id);
      persistenceStage = undefined;
      const attemptId = createUsageAttemptId();
      const abortController = new AbortController();
      operationRun = {
        operationId: request.operationId,
        run: previousRun,
        entryId: thread.entryId,
        abortController,
        phase: 'context-preparation',
        runIsActive: false,
        cancelRequested: false,
        startedAt: requestStartedAt,
        operation,
        failureTerminal,
      };
      this.activeRun = operationRun;
      let prepared: PreparedArticleContext;
      try {
        prepared = await this.contextService.prepare({
          signal: abortController.signal,
          source: {
            entryId: thread.entryId,
            title: content.readerTitle,
            sourceUrl: content.sourceUrl,
            markdown: content.markdown,
            sourceContentHash: currentHash,
            segments: content.segments ?? [],
          },
          history,
          question: userMessage.content,
          selection: userMessage.selection,
          textAttachments: attachments.flatMap((attachment) => (
            attachment.kind === 'text' && attachment.textContent !== undefined
              ? [{
                  id: attachment.id,
                  displayName: attachment.displayName,
                  mimeType: attachment.mimeType,
                  textContent: attachment.textContent,
                }]
              : []
          )),
          analysisModelFamily: `${profile.chatProviderKind}:${profile.chatModel}`,
          analysisUsage: {
            attemptId,
            taskRunId: previousRun.id,
            providerProfileId: profile.id,
            model: profile.chatModel,
          },
          contextWindowTokens: DEFAULT_CHAT_CONTEXT_WINDOW_TOKENS,
          responseReserveTokens: DEFAULT_CHAT_RESPONSE_RESERVE_TOKENS,
        });
      } catch (error) {
        const preparationError = normalizeChatOperationError(
          error,
          abortController.signal,
        );
        if (isChatInterruption(preparationError)) {
          this.finishPreparingRunInterruption(operationRun);
          throw preparationError;
        }
        this.logRunFailure(
          failureTerminal,
          operation,
          previousRun.id,
          requestStartedAt,
          'context-preparation',
          preparationError,
        );
        throw preparationError;
      }
      this.assertOperationCanContinue(operationRun);
      persistenceStage = 'run-reserve';
      this.assertOperationCanContinue(operationRun);
      const retried = this.chatStore.retryRun(request.runId);
      operationRun.run = retried.run;
      operationRun.runIsActive = true;
      const inputContentHash = hashChatInput([
        prepared.articleReference,
        prepared.historyReference,
        userMessage.content,
        ...attachments.map(({ contentHash }) => contentHash),
      ].join('\n'));
      persistenceStage = 'context-finalize';
      this.assertOperationCanContinue(operationRun);
      const finalizedRun = this.chatStore.finalizeRunContext(
        retried.run.id,
        prepared.mode,
        inputContentHash,
      );
      operationRun.run = finalizedRun;
      persistenceStage = undefined;
      let startupFailure: ChatExecutionFailure = {
        kind: 'run',
        stage: 'event-listener',
      };
      try {
        this.emit({
          type: 'started',
          runId: finalizedRun.id,
          threadId: thread.id,
          entryId: thread.entryId,
          messageId: retried.assistantMessage.id,
          contextMode: prepared.mode,
        });
        startupFailure = { kind: 'run', stage: 'provider' };
        const apiKey = this.secretLookup.read(profile.chatApiKeyRef);
        this.assertOperationCanContinue(operationRun);
        void this.executeRun(
          finalizedRun,
          thread.entryId,
          prepared,
          attachments,
          userMessage.content,
          profile,
          apiKey,
          abortController,
          attemptId,
        );
      } catch (error) {
        const startupError = normalizeChatOperationError(
          error,
          abortController.signal,
        );
        if (isChatInterruption(startupError)) {
          this.finishPreparingRunInterruption(operationRun);
        } else {
          this.finishActiveRunFailure(
            this.activeRun,
            startupError,
            startupFailure,
            undefined,
            false,
          );
        }
        throw startupError;
      }
      return {
        runId: finalizedRun.id,
        threadId: thread.id,
        userMessageId: retried.userMessage.id,
        assistantMessageId: retried.assistantMessage.id,
        reused: true,
      };
    } catch (error) {
      const operationError = operationRun
        ? normalizeChatOperationError(error, operationRun.abortController.signal)
        : error;
      if (operationRun && isChatInterruption(operationError)) {
        this.finishPreparingRunInterruption(operationRun);
      }
      if (persistenceStage && shouldRecordChatSystemFailure(operationError)) {
        logChatSessionPersistenceFailed(this.logger, failureTerminal, {
          operation,
          finalFailureStage: persistenceStage,
          durationMs: elapsedChatMilliseconds(requestStartedAt),
          success: false,
          errorCode: CHAT_LOG_ERROR_CODES.sessionPersistenceFailed,
          taskRunId: request.runId,
        });
      }
      throw operationError;
    } finally {
      if (
        operationRun
        && this.activeRun === operationRun
        && operationRun.phase === 'context-preparation'
      ) {
        this.activeRun = null;
      }
    }
  }

  async regenerate(
    request: ChatRegenerateRequest,
  ): Promise<ChatRunResponse> {
    const editedQuestion = request.question;
    if (
      !isValidOperationId(request.operationId)
      || !Number.isInteger(request.userMessageId)
      || request.userMessageId <= 0
      || (
        editedQuestion !== undefined
        && (!editedQuestion.trim() || editedQuestion.length > 20_000)
      )
      || this.activeRun
    ) {
      throw new ChatError(
        this.activeRun
          ? CHAT_ERROR_CODES.CHAT_BUSY
          : CHAT_ERROR_CODES.CHAT_INVALID_REQUEST,
        this.activeRun
          ? 'Another Article Chat answer is already being generated.'
          : 'The Article Chat regenerate request is invalid.',
        Boolean(this.activeRun),
      );
    }

    const requestStartedAt = performance.now();
    const failureTerminal = createChatFailureTerminal();
    const operation = 'regenerate' as const;
    let persistenceStage: ChatSessionFailureStage | undefined = 'session-load';
    let sourceMessage: ReturnType<ChatStore['findCurrentMessageById']>;
    let sourceRun: ReturnType<ChatStore['findRunByUserMessageId']>;
    try {
      sourceMessage = this.chatStore.findCurrentMessageById(
        request.userMessageId,
      );
      sourceRun = this.chatStore.findRunByUserMessageId(
        request.userMessageId,
      );
    } catch (error) {
      if (shouldRecordChatSystemFailure(error)) {
        logChatSessionPersistenceFailed(this.logger, failureTerminal, {
          operation,
          finalFailureStage: 'session-load',
          durationMs: elapsedChatMilliseconds(requestStartedAt),
          success: false,
          errorCode: CHAT_LOG_ERROR_CODES.sessionPersistenceFailed,
        });
      }
      throw error;
    }
    if (
      !sourceMessage
      || sourceMessage.role !== 'user'
      || !sourceRun
      || sourceRun.threadId !== sourceMessage.threadId
      || sourceRun.status === 'running'
    ) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_INVALID_REQUEST,
        'The Article Chat message can no longer be regenerated.',
        false,
      );
    }
    let thread: ReturnType<ChatStore['findThreadById']>;
    try {
      thread = this.chatStore.findThreadById(sourceMessage.threadId);
    } catch (error) {
      if (shouldRecordChatSystemFailure(error)) {
        logChatSessionPersistenceFailed(this.logger, failureTerminal, {
          operation,
          finalFailureStage: 'session-load',
          durationMs: elapsedChatMilliseconds(requestStartedAt),
          success: false,
          errorCode: CHAT_LOG_ERROR_CODES.sessionPersistenceFailed,
          taskRunId: sourceRun.id,
        });
      }
      throw error;
    }
    if (!thread) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_INVALID_REQUEST,
        'The Article Chat conversation is unavailable.',
        false,
      );
    }

    const question = (editedQuestion ?? sourceMessage.content).trim();
    let operationRun: ActiveChatRun | undefined;
    try {
      persistenceStage = undefined;
      const content = this.requireContent(thread.entryId);
      const currentHash = content.sourceContentHash
        ?? hashChatInput(content.markdown);
      if (currentHash !== thread.sourceContentHash) {
        throw new ChatError(
          CHAT_ERROR_CODES.CHAT_CONTENT_UNAVAILABLE,
          'The article changed after this answer was created. Ask again in the new conversation.',
          false,
        );
      }
      const profile = this.requireProfile();
      persistenceStage = 'session-load';
      const attachments = sourceMessage.attachments.map(({ id }) =>
        this.requireAttachment(id, thread.id));
      persistenceStage = undefined;
      if (
        attachments.some(({ kind }) => kind === 'image')
        && !profile.chatSupportsImages
      ) {
        throw new ChatError(
          CHAT_ERROR_CODES.CHAT_IMAGE_UNSUPPORTED,
          'The configured AI Chat model is not enabled for image input.',
          false,
        );
      }
      persistenceStage = 'session-load';
      const history = this.chatStore.listMessages(thread.id)
        .filter(({ id }) => id < sourceMessage.id);
      persistenceStage = undefined;
      const attemptId = createUsageAttemptId();
      persistenceStage = 'run-reserve';
      const created = this.chatStore.createReplacementRun({
        userMessageId: sourceMessage.id,
        threadId: thread.id,
        question,
        selection: sourceMessage.selection,
        attachmentIds: attachments.map(({ id }) => id),
        providerProfileId: profile.id,
        providerKind: profile.chatProviderKind,
        model: profile.chatModel,
        promptVersion: CHAT_PROMPT_VERSION,
        contextMode: 'article-map',
        articleContentHash: currentHash,
        inputContentHash: hashChatInput([
          currentHash,
          question,
          ...attachments.map(({ contentHash }) => contentHash),
        ].join('\n')),
      });
      persistenceStage = undefined;
      const abortController = new AbortController();
      operationRun = {
        operationId: request.operationId,
        run: created.run,
        entryId: thread.entryId,
        abortController,
        phase: 'context-preparation',
        runIsActive: true,
        cancelRequested: false,
        startedAt: requestStartedAt,
        operation,
        failureTerminal,
      };
      this.activeRun = operationRun;
      let prepared: PreparedArticleContext;
      try {
        prepared = await this.contextService.prepare({
          signal: abortController.signal,
          source: {
            entryId: thread.entryId,
            title: content.readerTitle,
            sourceUrl: content.sourceUrl,
            markdown: content.markdown,
            sourceContentHash: currentHash,
            segments: content.segments ?? [],
          },
          history,
          question,
          selection: sourceMessage.selection,
          textAttachments: attachments.flatMap((attachment) => (
            attachment.kind === 'text' && attachment.textContent !== undefined
              ? [{
                  id: attachment.id,
                  displayName: attachment.displayName,
                  mimeType: attachment.mimeType,
                  textContent: attachment.textContent,
                }]
              : []
          )),
          analysisModelFamily: `${profile.chatProviderKind}:${profile.chatModel}`,
          analysisUsage: {
            attemptId,
            taskRunId: created.run.id,
            providerProfileId: profile.id,
            model: profile.chatModel,
          },
          contextWindowTokens: DEFAULT_CHAT_CONTEXT_WINDOW_TOKENS,
          responseReserveTokens: DEFAULT_CHAT_RESPONSE_RESERVE_TOKENS,
        });
      } catch (error) {
        const preparationError = normalizeChatOperationError(
          error,
          abortController.signal,
        );
        if (isChatInterruption(preparationError)) {
          this.finishPreparingRunInterruption(operationRun);
          throw preparationError;
        }
        const failure = toChatIpcError(preparationError);
        try {
          this.chatStore.markRunFailed(created.run.id, failure);
        } catch (persistenceError) {
          logChatSessionPersistenceFailed(this.logger, failureTerminal, {
            operation,
            finalFailureStage: 'run-fail',
            durationMs: elapsedChatMilliseconds(requestStartedAt),
            success: false,
            errorCode: CHAT_LOG_ERROR_CODES.sessionPersistenceFailed,
            taskRunId: created.run.id,
          });
          throw persistenceError;
        }
        this.logRunFailure(
          failureTerminal,
          operation,
          created.run.id,
          requestStartedAt,
          'context-preparation',
          preparationError,
        );
        throw preparationError;
      }
      this.assertOperationCanContinue(operationRun);
      const inputContentHash = hashChatInput([
        prepared.articleReference,
        prepared.historyReference,
        question,
        ...attachments.map(({ contentHash }) => contentHash),
      ].join('\n'));
      persistenceStage = 'context-finalize';
      this.assertOperationCanContinue(operationRun);
      const finalizedRun = this.chatStore.finalizeRunContext(
        created.run.id,
        prepared.mode,
        inputContentHash,
      );
      operationRun.run = finalizedRun;
      persistenceStage = undefined;
      let startupFailure: ChatExecutionFailure = {
        kind: 'run',
        stage: 'event-listener',
      };
      try {
        this.emit({
          type: 'started',
          runId: finalizedRun.id,
          threadId: thread.id,
          entryId: thread.entryId,
          messageId: created.assistantMessage.id,
          contextMode: prepared.mode,
        });
        startupFailure = { kind: 'run', stage: 'provider' };
        const apiKey = this.secretLookup.read(profile.chatApiKeyRef);
        this.assertOperationCanContinue(operationRun);
        void this.executeRun(
          finalizedRun,
          thread.entryId,
          prepared,
          attachments,
          question,
          profile,
          apiKey,
          abortController,
          attemptId,
        );
      } catch (error) {
        const startupError = normalizeChatOperationError(
          error,
          abortController.signal,
        );
        if (isChatInterruption(startupError)) {
          this.finishPreparingRunInterruption(operationRun);
        } else {
          this.finishActiveRunFailure(
            this.activeRun,
            startupError,
            startupFailure,
            undefined,
            false,
          );
        }
        throw startupError;
      }
      return {
        runId: finalizedRun.id,
        threadId: thread.id,
        userMessageId: created.userMessage.id,
        assistantMessageId: created.assistantMessage.id,
        reused: false,
      };
    } catch (error) {
      const operationError = operationRun
        ? normalizeChatOperationError(error, operationRun.abortController.signal)
        : error;
      if (operationRun && isChatInterruption(operationError)) {
        this.finishPreparingRunInterruption(operationRun);
      }
      if (persistenceStage && shouldRecordChatSystemFailure(operationError)) {
        logChatSessionPersistenceFailed(this.logger, failureTerminal, {
          operation,
          finalFailureStage: persistenceStage,
          durationMs: elapsedChatMilliseconds(requestStartedAt),
          success: false,
          errorCode: CHAT_LOG_ERROR_CODES.sessionPersistenceFailed,
          taskRunId: sourceRun.id,
        });
      }
      throw operationError;
    } finally {
      if (
        operationRun
        && this.activeRun === operationRun
        && operationRun.phase === 'context-preparation'
      ) {
        this.activeRun = null;
      }
    }
  }

  handleEntryChange(nextEntryId: number | undefined): void {
    if (this.activeRun && this.activeRun.entryId !== nextEntryId) {
      this.interruptActiveRun();
    }
  }

  abortActiveRun(): void {
    if (this.activeRun) this.interruptActiveRun(false);
  }

  reconcileInterruptedRuns(): number {
    return this.chatStore.reconcileInterruptedRuns();
  }

  private interruptActiveRun(deferProviderTerminal = true): void {
    const active = this.activeRun;
    if (!active) return;
    if (active.cancelRequested) return;
    active.cancelRequested = true;
    const interruption = new ChatError(
      CHAT_ERROR_CODES.CHAT_INTERRUPTED,
      'Article Chat generation was interrupted before completion.',
      true,
    );
    active.abortController.abort(interruption);
    if (active.phase === 'context-preparation') return;
    if (!deferProviderTerminal) {
      this.finishRunInterruption(active, interruption);
      return;
    }
    // Let an already-rejected Provider request reach its catch first. This
    // preserves a real failure that happened before the cancellation signal.
    setTimeout(() => {
      if (this.activeRun === active) {
        this.finishRunInterruption(active, interruption);
      }
    }, 0);
  }

  private finishPreparingRunInterruption(active: ActiveChatRun): void {
    if (this.activeRun !== active) return;
    const interruption = new ChatError(
      CHAT_ERROR_CODES.CHAT_INTERRUPTED,
      'Article Chat generation was interrupted before completion.',
      true,
    );
    this.finishRunInterruption(active, interruption);
  }

  private finishRunInterruption(
    active: ActiveChatRun,
    interruption: ChatError,
  ): void {
    if (active.usageHandle) {
      this.usageRecorder.interrupt(
        active.usageHandle,
        undefined,
        CHAT_ERROR_CODES.CHAT_INTERRUPTED,
      );
    }
    if (active.runIsActive) {
      const error = toChatIpcError(interruption);
      this.chatStore.markRunFailed(active.run.id, error, 'interrupted');
      this.emit({
        type: 'interrupted',
        runId: active.run.id,
        threadId: active.run.threadId,
        entryId: active.entryId,
        messageId: active.run.assistantMessageId,
        error,
      });
    }
    if (this.activeRun === active) this.activeRun = null;
  }

  private assertOperationCanContinue(active: ActiveChatRun): void {
    if (
      this.activeRun !== active
      || active.cancelRequested
      || active.abortController.signal.aborted
    ) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_INTERRUPTED,
        'Article Chat generation was interrupted before completion.',
        true,
      );
    }
  }

  private async executeRun(
    run: ChatRun,
    entryId: number,
    prepared: PreparedArticleContext,
    attachments: readonly StoredChatAttachment[],
    question: string,
    profile: ActiveProviderProfile,
    apiKey: string,
    abortController: AbortController,
    attemptId: string,
  ): Promise<void> {
    let usage: ProviderTokenUsage | undefined;
    let usageHandle: UsageRequestHandle | undefined;
    let output = '';
    let executionFailure: ChatExecutionFailure = {
      kind: 'run',
      stage: 'provider',
    };
    let runMarkedSucceeded = false;
    try {
      const questionParts: ProviderContentPart[] = [{ type: 'text', text: question }];
      for (const attachment of attachments) {
        if (attachment.kind !== 'image') continue;
        if (!this.attachmentLoader) {
          throw new ChatError(
            CHAT_ERROR_CODES.CHAT_IMAGE_UNSUPPORTED,
            'Image attachment loading is unavailable.',
            false,
          );
        }
        executionFailure = { kind: 'attachment', stage: 'file-read' };
        questionParts.push({
          type: 'image',
          mimeType: attachment.mimeType === 'image/png'
            ? 'image/png'
            : 'image/jpeg',
          bytes: this.attachmentLoader.readImage(attachment),
        });
      }
      executionFailure = { kind: 'run', stage: 'provider' };
      const messages = [
        {
          role: 'user' as const,
          content: [{
            type: 'text' as const,
            text: [
              prepared.articleReference,
              prepared.historyReference,
            ].filter(Boolean).join('\n\n'),
          }],
        },
        { role: 'user' as const, content: questionParts },
      ];
      const providerRequest: TextGenerationProviderRequest = {
        providerKind: profile.chatProviderKind,
        baseUrl: profile.chatBaseUrl,
        model: profile.chatModel,
        apiKey,
        prompt: '',
        systemInstruction: prepared.systemInstruction,
        messages,
        signal: abortController.signal,
        requestUsage: true,
        onUsage: (reported) => {
          usage = sanitizeProviderTokenUsage(reported);
        },
      };
      const active = this.findContinuingRun(run.id);
      if (!active) return;
      usageHandle = this.usageRecorder.start({
        providerRequestId: createProviderRequestId(),
        attemptId,
        taskType: 'chat',
        taskRunId: run.id,
        providerProfileId: profile.id,
        model: profile.chatModel,
        requestKind: 'chat-answer',
      });
      active.usageHandle = usageHandle;
      active.phase = 'provider';
      for (let providerAttempt = 1; ; providerAttempt += 1) {
        executionFailure = { kind: 'run', stage: 'provider' };
        try {
          for await (const delta of this.provider.stream(providerRequest)) {
            if (!this.findContinuingRun(run.id)) return;
            output += delta;
            executionFailure = { kind: 'session', stage: 'delta-append' };
            this.chatStore.appendAssistantDelta(run.id, delta);
            executionFailure = { kind: 'run', stage: 'event-listener' };
            this.emit({
              type: 'delta',
              runId: run.id,
              threadId: run.threadId,
              entryId,
              messageId: run.assistantMessageId,
              text: delta,
            });
            executionFailure = { kind: 'run', stage: 'provider' };
          }
          break;
        } catch (error) {
          const failure = toChatIpcError(error);
          const retryDelayMs = getChatProviderRetryDelayMs(
            error,
            failure.code,
            providerAttempt,
          );
          const canRetry = (
            retryDelayMs !== undefined
            && output.length === 0
            && failure.retryable
            && !abortController.signal.aborted
          );
          if (!canRetry) throw error;
          usage = undefined;
          await waitForChatProviderRetry(
            retryDelayMs,
            abortController.signal,
          );
        }
      }
      if (!this.findContinuingRun(run.id)) return;
      if (!output.trim()) {
        executionFailure = { kind: 'run', stage: 'empty-response' };
        throw new ChatError(
          CHAT_ERROR_CODES.CHAT_EMPTY_OUTPUT,
          'The Provider returned an empty Article Chat answer.',
          true,
        );
      }
      if (!this.findContinuingRun(run.id)) return;
      this.usageRecorder.complete(usageHandle, usage);
      executionFailure = { kind: 'session', stage: 'run-finalize' };
      if (!this.findContinuingRun(run.id)) return;
      this.chatStore.markRunSucceeded(run.id);
      runMarkedSucceeded = true;
      const message = this.chatStore.findMessageById(run.assistantMessageId);
      if (!message) throw new Error('Completed Chat message was not persisted.');
      executionFailure = { kind: 'run', stage: 'event-listener' };
      if (!this.findContinuingRun(run.id)) return;
      this.emit({
        type: 'completed',
        runId: run.id,
        threadId: run.threadId,
        entryId,
        messageId: run.assistantMessageId,
        message,
      });
    } catch (error) {
      if (this.activeRun?.run.id !== run.id) return;
      const operationError = normalizeChatOperationError(
        error,
        abortController.signal,
      );
      if (isChatInterruption(operationError)) {
        this.finishRunInterruption(
          this.activeRun,
          new ChatError(
            CHAT_ERROR_CODES.CHAT_INTERRUPTED,
            'Article Chat generation was interrupted before completion.',
            true,
          ),
        );
      } else {
        this.finishActiveRunFailure(
          this.activeRun,
          operationError,
          executionFailure,
          usage,
          runMarkedSucceeded,
        );
      }
    } finally {
      if (this.activeRun?.run.id === run.id) this.activeRun = null;
    }
  }

  private finishActiveRunFailure(
    active: ActiveChatRun | null,
    error: unknown,
    executionFailure: ChatExecutionFailure,
    usage: ProviderTokenUsage | undefined,
    runMarkedSucceeded: boolean,
  ): void {
    if (!active) return;
    const failure = toChatIpcError(error);
    if (active.usageHandle) {
      this.usageRecorder.fail(active.usageHandle, failure.code, usage);
    }

    let terminalFailure = executionFailure;
    if (!runMarkedSucceeded) {
      try {
        this.chatStore.markRunFailed(active.run.id, failure);
      } catch {
        terminalFailure = { kind: 'session', stage: 'run-fail' };
      }
      try {
        this.emit({
          type: 'failed',
          runId: active.run.id,
          threadId: active.run.threadId,
          entryId: active.entryId,
          messageId: active.run.assistantMessageId,
          error: failure,
        });
      } catch {
        // The terminal record below owns observability for listener failures.
      }
    }

    if (terminalFailure.kind === 'session') {
      logChatSessionPersistenceFailed(
        this.logger,
        active.failureTerminal,
        {
          operation: active.operation,
          finalFailureStage: terminalFailure.stage,
          durationMs: elapsedChatMilliseconds(active.startedAt),
          success: false,
          errorCode: CHAT_LOG_ERROR_CODES.sessionPersistenceFailed,
          taskRunId: active.run.id,
        },
      );
    } else if (terminalFailure.kind === 'attachment') {
      logChatAttachmentOperationFailed(
        this.logger,
        active.failureTerminal,
        {
          operation: active.operation,
          finalFailureStage: terminalFailure.stage,
          durationMs: elapsedChatMilliseconds(active.startedAt),
          success: false,
          errorCode: CHAT_LOG_ERROR_CODES.attachmentOperationFailed,
          taskRunId: active.run.id,
        },
      );
    } else {
      this.logRunFailure(
        active.failureTerminal,
        active.operation,
        active.run.id,
        active.startedAt,
        terminalFailure.stage,
        error,
      );
    }
    if (this.activeRun?.run.id === active.run.id) this.activeRun = null;
  }

  private findContinuingRun(runId: number): ActiveChatRun | undefined {
    const active = this.activeRun;
    if (!active || active.run.id !== runId) return undefined;
    this.assertOperationCanContinue(active);
    return active;
  }

  private logRunFailure(
    terminal: ChatFailureTerminal,
    operation: ChatRunLogOperation,
    taskRunId: number,
    startedAt: number,
    finalFailureStage: ChatRunFailureStage,
    error: unknown,
  ): void {
    const failure = toChatIpcError(error);
    if (
      finalFailureStage !== 'event-listener'
      && !shouldRecordChatRunFailure(failure.code)
    ) return;
    logChatRunFailed(this.logger, terminal, {
      operation,
      finalFailureStage,
      durationMs: elapsedChatMilliseconds(startedAt),
      success: false,
      errorCode: finalFailureStage === 'event-listener'
        ? CHAT_LOG_ERROR_CODES.eventListenerFailed
        : failure.code as (typeof CHAT_ERROR_CODES)[keyof typeof CHAT_ERROR_CODES],
      taskRunId,
    });
  }

  private requireContent(entryId: number): CleanedContent {
    const content = this.contentLookup.findByEntry(entryId);
    if (
      !content
      || content.pipelineStatus !== 'success'
      || !content.markdown.trim()
    ) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_CONTENT_UNAVAILABLE,
        'AI Chat needs successfully cleaned article content.',
        true,
      );
    }
    return content;
  }

  private requireProfile(): ActiveProviderProfile {
    const profile = this.profileLookup.findActiveWithSecret();
    if (!profile || !profile.chatApiKeyRef) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_PROVIDER_NOT_CONFIGURED,
        'Configure an AI Chat Provider before asking a question.',
        false,
      );
    }
    return profile;
  }

  private requireAttachment(
    attachmentId: number,
    threadId: number,
  ): StoredChatAttachment {
    const attachment = this.chatStore.findStoredAttachment(attachmentId);
    if (!attachment || attachment.threadId !== threadId) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_ATTACHMENT_NOT_FOUND,
        'One of the selected Chat attachments is unavailable.',
        false,
      );
    }
    return attachment;
  }

  private emit(event: ChatStreamEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}

function validateEntryId(entryId: number): void {
  if (!Number.isInteger(entryId) || entryId <= 0) {
    throw new ChatError(
      CHAT_ERROR_CODES.CHAT_INVALID_REQUEST,
      'The Article Chat entry is invalid.',
      false,
    );
  }
}

function validateSendRequest(request: ChatSendRequest): void {
  validateEntryId(request.entryId);
  if (
    !isValidOperationId(request.operationId)
    || !request.question.trim()
    || request.question.length > 20_000
    || request.attachmentIds.length > 5
    || !request.attachmentIds.every((id) => Number.isInteger(id) && id > 0)
    || new Set(request.attachmentIds).size !== request.attachmentIds.length
    || (
      request.selection !== undefined
      && (
        request.selection.entryId !== request.entryId
        || !request.selection.text.trim()
        || request.selection.text.length > CHAT_SELECTION_LIMITS.textCharacters
        || !request.selection.paragraphContext.trim()
        || request.selection.paragraphContext.length
          > CHAT_SELECTION_LIMITS.paragraphCharacters
        || (
          request.selection.segmentId !== undefined
          && (
            !request.selection.segmentId.trim()
            || request.selection.segmentId.length
              > CHAT_SELECTION_LIMITS.segmentIdCharacters
          )
        )
      )
    )
  ) {
    throw new ChatError(
      CHAT_ERROR_CODES.CHAT_INVALID_REQUEST,
      'The Article Chat request is invalid.',
      false,
    );
  }
}

function isValidOperationId(value: unknown): value is string {
  return typeof value === 'string'
    && Boolean(value.trim())
    && value.length <= CHAT_OPERATION_ID_MAX_LENGTH;
}

function normalizeChatOperationError(
  error: unknown,
  signal: AbortSignal,
): unknown {
  if (isChatInterruption(error)) return error;
  if (!signal.aborted || !isAbortError(error)) return error;
  return new ChatError(
    CHAT_ERROR_CODES.CHAT_INTERRUPTED,
    'Article Chat generation was interrupted before completion.',
    true,
  );
}

function isChatInterruption(error: unknown): boolean {
  return toChatIpcError(error).code === CHAT_ERROR_CODES.CHAT_INTERRUPTED;
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const candidate = error as Error & { code?: unknown };
  return candidate.name === 'AbortError' || candidate.code === 'ABORT_ERR';
}

function hashChatInput(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const EXPECTED_CHAT_BUSINESS_ERROR_CODES = new Set<string>([
  CHAT_ERROR_CODES.CHAT_PROVIDER_NOT_CONFIGURED,
  CHAT_ERROR_CODES.CHAT_CONTENT_UNAVAILABLE,
  CHAT_ERROR_CODES.CHAT_BUSY,
  CHAT_ERROR_CODES.CHAT_INTERRUPTED,
  CHAT_ERROR_CODES.CHAT_ATTACHMENT_NOT_FOUND,
  CHAT_ERROR_CODES.CHAT_ATTACHMENT_LIMIT_EXCEEDED,
  CHAT_ERROR_CODES.CHAT_ATTACHMENT_TOO_LARGE,
  CHAT_ERROR_CODES.CHAT_ATTACHMENT_TYPE_UNSUPPORTED,
  CHAT_ERROR_CODES.CHAT_ATTACHMENT_PARSE_FAILED,
  CHAT_ERROR_CODES.CHAT_IMAGE_INVALID,
  CHAT_ERROR_CODES.CHAT_IMAGE_TOO_LARGE,
  CHAT_ERROR_CODES.CHAT_IMAGE_DIMENSIONS_UNSAFE,
  CHAT_ERROR_CODES.CHAT_IMAGE_UNSUPPORTED,
  CHAT_ERROR_CODES.CHAT_PDF_ENCRYPTED,
  CHAT_ERROR_CODES.CHAT_PDF_TEXT_UNAVAILABLE,
  CHAT_ERROR_CODES.CHAT_UNAUTHORIZED,
  CHAT_ERROR_CODES.CHAT_INVALID_REQUEST,
]);

function shouldRecordChatRunFailure(errorCode: string): boolean {
  return !EXPECTED_CHAT_BUSINESS_ERROR_CODES.has(errorCode);
}

function shouldRecordChatSystemFailure(error: unknown): boolean {
  return toChatIpcError(error).code === CHAT_ERROR_CODES.CHAT_UNKNOWN_ERROR;
}

function getChatProviderRetryDelayMs(
  error: unknown,
  errorCode: string,
  providerAttempt: number,
): number | undefined {
  const retryIndex = providerAttempt - 1;
  const retryDelays = errorCode === CHAT_ERROR_CODES.CHAT_PROVIDER_TIMEOUT
    ? CHAT_PROVIDER_TIMEOUT_RETRY_DELAYS_MS
    : (
      errorCode === CHAT_ERROR_CODES.CHAT_PROVIDER_REQUEST_FAILED
      || errorCode === CHAT_ERROR_CODES.CHAT_NETWORK_ERROR
    )
      ? CHAT_PROVIDER_RETRY_DELAYS_MS
      : [];
  const defaultDelayMs = retryDelays[retryIndex];
  if (defaultDelayMs === undefined) return undefined;
  const providerDelayMs = (
    error instanceof SummaryError
    && error.code === SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_REQUEST_FAILED
  )
    ? error.retryAfterMs
    : undefined;
  return Math.max(defaultDelayMs, providerDelayMs ?? 0);
}

function waitForChatProviderRetry(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new ChatError(
      CHAT_ERROR_CODES.CHAT_INTERRUPTED,
      'Article Chat generation was interrupted before retrying.',
      true,
    ));
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', handleAbort);
    };
    const handleAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ChatError(
        CHAT_ERROR_CODES.CHAT_INTERRUPTED,
        'Article Chat generation was interrupted before retrying.',
        true,
      ));
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, delayMs);
    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted) handleAbort();
  });
}
