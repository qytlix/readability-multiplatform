import { createHash } from 'node:crypto';
import type { CleanedContent } from '../../../shared/contracts/content.types';
import {
  CHAT_PROMPT_VERSION,
  CHAT_SELECTION_LIMITS,
  type ChatCancelRequest,
  type ChatGetRequest,
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
import type {
  ProviderContentPart,
  ProviderTokenUsage,
  TextGenerationProvider,
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
  elapsedChatMilliseconds,
  logChatRecoveryCompleted,
  logChatRunCompleted,
  logChatRunFailed,
  logChatRunInterrupted,
  logChatRunStarted,
  type ChatOperationLogger,
} from './ChatLogging';
import { performance } from 'node:perf_hooks';

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
  run: ChatRun;
  entryId: number;
  abortController: AbortController;
  usageHandle: UsageRequestHandle;
  startedAt: number;
}

export class ChatService {
  private activeRun: ActiveChatRun | null = null;
  private preparing = false;
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
  }

  async send(request: ChatSendRequest): Promise<ChatRunResponse> {
    validateSendRequest(request);
    if (this.activeRun || this.preparing) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_BUSY,
        'Another Article Chat answer is already being generated.',
        true,
      );
    }
    this.preparing = true;
    try {
      const content = this.requireContent(request.entryId);
      const sourceContentHash = content.sourceContentHash
        ?? hashChatInput(content.markdown);
      const profile = this.requireProfile();
      const thread = this.chatStore.findOrCreateThread(
        request.entryId,
        sourceContentHash,
        CHAT_PROMPT_VERSION,
      );
      const attachments = request.attachmentIds.map((attachmentId) =>
        this.requireAttachment(attachmentId, thread.id));
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
      const history = this.chatStore.listMessages(thread.id);
      const prepared = await this.contextService.prepare({
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
        contextWindowTokens: DEFAULT_CHAT_CONTEXT_WINDOW_TOKENS,
        responseReserveTokens: DEFAULT_CHAT_RESPONSE_RESERVE_TOKENS,
      });
      const inputContentHash = hashChatInput([
        prepared.articleReference,
        prepared.historyReference,
        request.question.trim(),
        ...attachments.map(({ contentHash }) => contentHash),
      ].join('\n'));
      const created = this.chatStore.createRunWithMessages({
        threadId: thread.id,
        question: request.question.trim(),
        selection: request.selection,
        providerProfileId: profile.id,
        providerKind: profile.chatProviderKind,
        model: profile.chatModel,
        promptVersion: CHAT_PROMPT_VERSION,
        contextMode: prepared.mode,
        articleContentHash: sourceContentHash,
        inputContentHash,
      });
      this.chatStore.linkAttachments(
        created.userMessage.id,
        request.attachmentIds,
      );
      const abortController = new AbortController();
      const usageHandle = this.usageRecorder.start({
        providerRequestId: createProviderRequestId(),
        attemptId: createUsageAttemptId(),
        taskType: 'chat',
        taskRunId: created.run.id,
        providerProfileId: profile.id,
        model: profile.chatModel,
        requestKind: 'chat-answer',
      });
      this.activeRun = {
        run: created.run,
        entryId: request.entryId,
        abortController,
        usageHandle,
        startedAt: performance.now(),
      };
      logChatRunStarted(this.logger, created.run.id);
      this.emit({
        type: 'started',
        runId: created.run.id,
        threadId: thread.id,
        entryId: request.entryId,
        messageId: created.assistantMessage.id,
        contextMode: prepared.mode,
      });
      void this.executeRun(
        created.run,
        request.entryId,
        prepared,
        attachments,
        request.question.trim(),
        profile,
        this.secretLookup.read(profile.chatApiKeyRef),
        abortController,
        usageHandle,
      );
      return {
        runId: created.run.id,
        threadId: thread.id,
        userMessageId: created.userMessage.id,
        assistantMessageId: created.assistantMessage.id,
        reused: false,
      };
    } finally {
      this.preparing = false;
    }
  }

  cancel(request: ChatCancelRequest): void {
    if (!Number.isInteger(request.runId) || request.runId <= 0) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_INVALID_REQUEST,
        'The Article Chat cancel request is invalid.',
        false,
      );
    }
    if (!this.activeRun || this.activeRun.run.id !== request.runId) {
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
      !Number.isInteger(request.runId)
      || request.runId <= 0
      || this.activeRun
      || this.preparing
    ) {
      throw new ChatError(
        this.activeRun || this.preparing
          ? CHAT_ERROR_CODES.CHAT_BUSY
          : CHAT_ERROR_CODES.CHAT_INVALID_REQUEST,
        this.activeRun || this.preparing
          ? 'Another Article Chat answer is already being generated.'
          : 'The Article Chat retry request is invalid.',
        Boolean(this.activeRun || this.preparing),
      );
    }
    const previousRun = this.chatStore.findRunById(request.runId);
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
    const thread = this.chatStore.findThreadById(previousRun.threadId);
    const userMessage = this.chatStore.findMessageById(previousRun.userMessageId);
    if (!thread || !userMessage) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_INVALID_REQUEST,
        'The Article Chat retry source is unavailable.',
        false,
      );
    }

    this.preparing = true;
    try {
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
      const attachments = userMessage.attachments.map(({ id }) =>
        this.requireAttachment(id, thread.id));
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
      const history = this.chatStore.listMessages(thread.id)
        .filter(({ id }) => id < userMessage.id);
      const prepared = await this.contextService.prepare({
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
        contextWindowTokens: DEFAULT_CHAT_CONTEXT_WINDOW_TOKENS,
        responseReserveTokens: DEFAULT_CHAT_RESPONSE_RESERVE_TOKENS,
      });
      const retried = this.chatStore.retryRun(request.runId);
      const abortController = new AbortController();
      const usageHandle = this.usageRecorder.start({
        providerRequestId: createProviderRequestId(),
        attemptId: createUsageAttemptId(),
        taskType: 'chat',
        taskRunId: retried.run.id,
        providerProfileId: profile.id,
        model: profile.chatModel,
        requestKind: 'chat-answer',
      });
      this.activeRun = {
        run: retried.run,
        entryId: thread.entryId,
        abortController,
        usageHandle,
        startedAt: performance.now(),
      };
      logChatRunStarted(this.logger, retried.run.id);
      this.emit({
        type: 'started',
        runId: retried.run.id,
        threadId: thread.id,
        entryId: thread.entryId,
        messageId: retried.assistantMessage.id,
        contextMode: prepared.mode,
      });
      void this.executeRun(
        retried.run,
        thread.entryId,
        prepared,
        attachments,
        userMessage.content,
        profile,
        this.secretLookup.read(profile.chatApiKeyRef),
        abortController,
        usageHandle,
      );
      return {
        runId: retried.run.id,
        threadId: thread.id,
        userMessageId: retried.userMessage.id,
        assistantMessageId: retried.assistantMessage.id,
        reused: true,
      };
    } finally {
      this.preparing = false;
    }
  }

  handleEntryChange(nextEntryId: number | undefined): void {
    if (this.activeRun && this.activeRun.entryId !== nextEntryId) {
      this.interruptActiveRun();
    }
  }

  abortActiveRun(): void {
    if (this.activeRun) this.interruptActiveRun();
  }

  reconcileInterruptedRuns(): number {
    const startedAt = performance.now();
    const count = this.chatStore.reconcileInterruptedRuns();
    logChatRecoveryCompleted(this.logger, {
      durationMs: elapsedChatMilliseconds(startedAt),
      count,
    });
    return count;
  }

  private interruptActiveRun(): void {
    const active = this.activeRun;
    if (!active) return;
    const error = toChatIpcError(new ChatError(
      CHAT_ERROR_CODES.CHAT_INTERRUPTED,
      'Article Chat generation was interrupted before completion.',
      true,
    ));
    active.abortController.abort();
    this.usageRecorder.interrupt(
      active.usageHandle,
      undefined,
      CHAT_ERROR_CODES.CHAT_INTERRUPTED,
    );
    this.chatStore.markRunFailed(active.run.id, error, 'interrupted');
    this.emit({
      type: 'interrupted',
      runId: active.run.id,
      threadId: active.run.threadId,
      entryId: active.entryId,
      messageId: active.run.assistantMessageId,
      error,
    });
    logChatRunInterrupted(this.logger, {
      taskRunId: active.run.id,
      durationMs: elapsedChatMilliseconds(active.startedAt),
      errorCode: CHAT_ERROR_CODES.CHAT_INTERRUPTED,
    });
    this.activeRun = null;
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
    usageHandle: UsageRequestHandle,
  ): Promise<void> {
    let usage: ProviderTokenUsage | undefined;
    let output = '';
    try {
      const questionParts: ProviderContentPart[] = [
        { type: 'text', text: question },
        ...attachments.flatMap((attachment): ProviderContentPart[] => {
          if (attachment.kind !== 'image') return [];
          if (!this.attachmentLoader) {
            throw new ChatError(
              CHAT_ERROR_CODES.CHAT_IMAGE_UNSUPPORTED,
              'Image attachment loading is unavailable.',
              false,
            );
          }
          return [{
            type: 'image',
            mimeType: attachment.mimeType === 'image/png'
              ? 'image/png'
              : 'image/jpeg',
            bytes: this.attachmentLoader.readImage(attachment),
          }];
        }),
      ];
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
      for await (const delta of this.provider.stream({
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
      })) {
        if (this.activeRun?.run.id !== run.id) return;
        output += delta;
        this.chatStore.appendAssistantDelta(run.id, delta);
        this.emit({
          type: 'delta',
          runId: run.id,
          threadId: run.threadId,
          entryId,
          messageId: run.assistantMessageId,
          text: delta,
        });
      }
      if (!output.trim()) {
        throw new ChatError(
          CHAT_ERROR_CODES.CHAT_EMPTY_OUTPUT,
          'The Provider returned an empty Article Chat answer.',
          true,
        );
      }
      this.usageRecorder.complete(usageHandle, usage);
      this.chatStore.markRunSucceeded(run.id);
      const message = this.chatStore.findMessageById(run.assistantMessageId);
      if (!message) throw new Error('Completed Chat message was not persisted.');
      this.emit({
        type: 'completed',
        runId: run.id,
        threadId: run.threadId,
        entryId,
        messageId: run.assistantMessageId,
        message,
      });
      logChatRunCompleted(this.logger, {
        taskRunId: run.id,
        durationMs: elapsedChatMilliseconds(
          this.activeRun?.startedAt ?? performance.now(),
        ),
      });
    } catch (error) {
      if (this.activeRun?.run.id !== run.id) return;
      const failure = toChatIpcError(error);
      this.usageRecorder.fail(usageHandle, failure.code, usage);
      this.chatStore.markRunFailed(run.id, failure);
      this.emit({
        type: 'failed',
        runId: run.id,
        threadId: run.threadId,
        entryId,
        messageId: run.assistantMessageId,
        error: failure,
      });
      logChatRunFailed(this.logger, {
        taskRunId: run.id,
        durationMs: elapsedChatMilliseconds(
          this.activeRun?.startedAt ?? performance.now(),
        ),
        errorCode: failure.code as (
          typeof CHAT_ERROR_CODES
        )[keyof typeof CHAT_ERROR_CODES],
      });
    } finally {
      if (this.activeRun?.run.id === run.id) this.activeRun = null;
    }
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
    !request.question.trim()
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

function hashChatInput(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
