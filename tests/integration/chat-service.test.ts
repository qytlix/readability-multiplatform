import { describe, expect, it, vi } from 'vitest';
import { ProviderProfileStore } from '../../src/main/ai/stores/ProviderProfileStore';
import { ChatStore } from '../../src/main/ai/stores/ChatStore';
import { ChatService } from '../../src/main/ai/services/ChatService';
import type { TextGenerationProvider } from '../../src/main/ai/provider/TextGenerationProvider';
import { buildTestDbWithData } from '../fixtures/databases/feed-fixture';
import { ContentStore } from '../../src/main/feed/stores/ContentStore';
import type {
  PreparedArticleContext,
  PrepareArticleContextRequest,
} from '../../src/main/ai/services/ArticleContextService';
import type { StartUsageRequestParams } from '../../src/main/ai/stores/UsageStore';
import type {
  UsageRecorderPort,
  UsageRequestHandle,
} from '../../src/main/ai/services/UsageRecorder';
import {
  CHAT_ERROR_CODES,
  ChatError,
} from '../../src/shared/errors/chat.errors';
import {
  SUMMARY_ERROR_CODES,
  SummaryError,
} from '../../src/shared/errors/summary.errors';
import {
  CHAT_LOG_EVENTS,
  type ChatOperationLogger,
} from '../../src/main/ai/services/ChatLogging';

describe('ChatService', () => {
  it('streams and persists a content-scoped answer with full event identity', async () => {
    const { db } = buildTestDbWithData();
    const contentStore = new ContentStore(db);
    contentStore.upsert({
      entryId: 1,
      markdown: 'Article body',
      cleanedHtml: '<p>Article body</p>',
      sourceContentHash: 'article-hash',
      pipelineStatus: 'success',
    });
    const profileStore = new ProviderProfileStore(db);
    profileStore.saveActive({
      summary: {
        providerKind: 'openai',
        baseUrl: 'https://provider.test/v1',
        model: 'summary-model',
        apiKeyRef: 'summary-key',
      },
      translation: {
        providerKind: 'openai',
        baseUrl: 'https://provider.test/v1',
        model: 'translation-model',
        apiKeyRef: 'translation-key',
      },
      tag: {
        providerKind: 'openai',
        baseUrl: 'https://provider.test/v1',
        model: 'tag-model',
        apiKeyRef: 'tag-key',
      },
      chat: {
        providerKind: 'openai',
        baseUrl: 'https://provider.test/v1',
        model: 'chat-model',
        apiKeyRef: 'chat-key',
        supportsImages: false,
      },
    });
    const provider: TextGenerationProvider = {
      async *stream(request) {
        expect(request.systemInstruction).toContain('Shale Article Guide');
        expect(request.messages).toHaveLength(2);
        request.onTiming?.('response-headers');
        request.onTiming?.('first-delta');
        yield 'First ';
        yield 'answer.';
      },
      testConnection: () => Promise.resolve(),
    };
    const chatStore = new ChatStore(db);
    const prepare = vi.fn(async (
      request: PrepareArticleContextRequest,
    ) => {
      void request;
      return {
      mode: 'full' as const,
      systemInstruction: 'You are Shale Article Guide.',
      articleReference: '<article-context>Article body</article-context>',
      historyReference: '',
      estimatedPromptTokens: 20,
      cacheHit: false,
      relatedSegmentIds: [],
      };
    });
    const startUsage = vi.fn((
      params: StartUsageRequestParams,
    ): UsageRequestHandle => ({
      providerRequestId: params.providerRequestId,
      attemptId: params.attemptId,
      taskRunId: params.taskRunId,
      persisted: true,
      settled: false,
    }));
    const usageRecorder = {
      start: startUsage,
      complete: vi.fn(),
      fail: vi.fn(),
      interrupt: vi.fn(),
      reconcileInterruptedRunning: vi.fn(),
      listByAttempt: vi.fn(() => []),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const service = new ChatService(
      contentStore,
      profileStore,
      { read: () => 'secret' },
      chatStore,
      { prepare },
      provider,
      undefined,
      usageRecorder,
      logger,
    );
    const events: string[] = [];
    const completed = new Promise<void>((resolve) => {
      service.subscribe((event) => {
        events.push(event.type);
        expect(event).toMatchObject({
          runId: expect.any(Number),
          threadId: expect.any(Number),
          entryId: 1,
          messageId: expect.any(Number),
        });
        if (event.type === 'completed') resolve();
      });
    });

    const response = await service.send({
      operationId: 'stream-answer',
      entryId: 1,
      question: 'What is the point?',
      attachmentIds: [],
    });
    await completed;

    expect(events).toEqual(['started', 'delta', 'delta', 'completed']);
    expect(chatStore.findRunById(response.runId)?.status).toBe('succeeded');
    expect(chatStore.findRunById(response.runId)?.contextMode).toBe('full');
    expect(prepare.mock.calls[0]?.[0].analysisUsage).toMatchObject({
      taskRunId: response.runId,
      providerProfileId: expect.any(Number),
      model: 'chat-model',
    });
    expect(startUsage).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: prepare.mock.calls[0]?.[0].analysisUsage?.attemptId,
      taskRunId: response.runId,
      requestKind: 'chat-answer',
    }));
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(chatStore.findMessageById(response.assistantMessageId)).toMatchObject({
      status: 'completed',
      content: 'First answer.',
    });
    expect(service.getState({ entryId: 1 })).toMatchObject({
      state: 'idle',
      messages: [
        { role: 'user', content: 'What is the point?' },
        { role: 'assistant', content: 'First answer.' },
      ],
    });
  });

  it('rejects a second run before creating duplicate messages', async () => {
    const { db } = buildTestDbWithData();
    const contentStore = new ContentStore(db);
    contentStore.upsert({
      entryId: 1,
      markdown: 'Article body',
      sourceContentHash: 'article-hash',
      pipelineStatus: 'success',
    });
    const profileStore = new ProviderProfileStore(db);
    profileStore.saveActive({
      providerKind: 'openai',
      baseUrl: 'https://provider.test/v1',
      model: 'chat-model',
      apiKeyRef: 'chat-key',
    });
    let release: (() => void) | undefined;
    const provider: TextGenerationProvider = {
      async *stream() {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        yield 'done';
      },
      testConnection: () => Promise.resolve(),
    };
    const service = new ChatService(
      contentStore,
      profileStore,
      { read: () => 'secret' },
      new ChatStore(db),
      {
        prepare: async () => ({
          mode: 'full',
          systemInstruction: 'system',
          articleReference: 'article',
          historyReference: '',
          estimatedPromptTokens: 2,
          cacheHit: false,
          relatedSegmentIds: [],
        }),
      },
      provider,
    );

    await service.send({
      operationId: 'first-run',
      entryId: 1,
      question: 'first',
      attachmentIds: [],
    });
    await expect(service.send({
      operationId: 'duplicate-run',
      entryId: 1,
      question: 'second',
      attachmentIds: [],
    })).rejects.toMatchObject({ code: 'CHAT_BUSY' });
    release?.();
  });

  it('cancels an active run and ignores late Provider output', async () => {
    const usageRecorder = createUsageRecorderDouble();
    const harness = createChatServiceHarness(async function* () {
      await new Promise((resolve) => setTimeout(resolve, 20));
      yield 'late';
    }, undefined, undefined, usageRecorder);
    const events: string[] = [];
    harness.service.subscribe((event) => events.push(event.type));
    const response = await harness.service.send({
      operationId: 'cancel-run',
      entryId: 1,
      question: 'cancel me',
      attachmentIds: [],
    });

    harness.service.cancel({ runId: response.runId });
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(events).toEqual(['started', 'interrupted']);
    expect(harness.chatStore.findRunById(response.runId)?.status).toBe('interrupted');
    expect(harness.chatStore.findMessageById(response.assistantMessageId)).toMatchObject({
      status: 'interrupted',
      content: '',
    });
    expect(usageRecorder.start).toHaveBeenCalledOnce();
    expect(usageRecorder.interrupt).toHaveBeenCalledOnce();
    expect(usageRecorder.complete).not.toHaveBeenCalled();
    expect(usageRecorder.fail).not.toHaveBeenCalled();
  });

  it('keeps a real answer Provider failure when cancellation follows its rejection', async () => {
    let rejectProvider: ((error: Error) => void) | undefined;
    let markProviderStarted = (): void => undefined;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    const logger = createChatLoggerDouble();
    const usageRecorder = createUsageRecorderDouble();
    const harness = createChatServiceHarness(async function* () {
      markProviderStarted();
      await new Promise<never>((_resolve, reject) => {
        rejectProvider = reject;
      });
      yield 'unreachable';
    }, undefined, logger, usageRecorder);
    const failed = new Promise<void>((resolve) => {
      harness.service.subscribe((event) => {
        if (event.type === 'failed') resolve();
      });
    });
    const response = await harness.service.send({
      operationId: 'provider-failure-before-cancel',
      entryId: 1,
      question: 'preserve the Provider failure',
      attachmentIds: [],
    });
    await providerStarted;

    rejectProvider?.(new Error('REAL_ANSWER_PROVIDER_FAILURE'));
    harness.service.cancel({ runId: response.runId });
    await failed;

    expect(harness.chatStore.findRunById(response.runId)).toMatchObject({
      status: 'failed',
      error: { code: CHAT_ERROR_CODES.CHAT_UNKNOWN_ERROR },
    });
    expect(usageRecorder.fail).toHaveBeenCalledOnce();
    expect(usageRecorder.interrupt).not.toHaveBeenCalled();
    expectSingleChatFailure(logger, CHAT_LOG_EVENTS.runFailed, {
      operation: 'send',
      finalFailureStage: 'provider',
      errorCode: CHAT_ERROR_CODES.CHAT_UNKNOWN_ERROR,
    });
  });

  it('lets cancellation win when the answer Provider completes in the same turn', async () => {
    let releaseProvider = (): void => undefined;
    let markProviderStarted = (): void => undefined;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const usageRecorder = createUsageRecorderDouble();
    const harness = createChatServiceHarness(async function* () {
      markProviderStarted();
      await providerGate;
      yield 'too late';
    }, undefined, undefined, usageRecorder);
    const events: string[] = [];
    harness.service.subscribe((event) => events.push(event.type));
    const response = await harness.service.send({
      operationId: 'provider-completion-cancel-race',
      entryId: 1,
      question: 'cancel at completion',
      attachmentIds: [],
    });
    await providerStarted;

    releaseProvider();
    harness.service.cancel({ runId: response.runId });
    await vi.waitFor(() => {
      expect(harness.chatStore.findRunById(response.runId)?.status)
        .toBe('interrupted');
    });

    expect(events).toEqual(['started', 'interrupted']);
    expect(harness.chatStore.findMessageById(response.assistantMessageId))
      .toMatchObject({ status: 'interrupted', content: '' });
    expect(usageRecorder.interrupt).toHaveBeenCalledOnce();
    expect(usageRecorder.complete).not.toHaveBeenCalled();
  });

  it('retries one retryable Provider failure before any answer text is emitted', async () => {
    let attemptCount = 0;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const harness = createChatServiceHarness(async function* (request) {
      attemptCount += 1;
      request.onTiming?.('response-headers');
      if (attemptCount === 1) {
        throw new SummaryError(
          SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_REQUEST_FAILED,
          'The upstream Provider failed while starting the stream.',
          true,
        );
      }
      request.onTiming?.('first-delta');
      yield 'recovered';
    }, undefined, logger);
    const events: string[] = [];
    const terminalEvent = new Promise<string>((resolve) => {
      harness.service.subscribe((event) => {
        events.push(event.type);
        if (event.type === 'completed' || event.type === 'failed') {
          resolve(event.type);
        }
      });
    });

    const response = await harness.service.send({
      operationId: 'usage-run',
      entryId: 1,
      question: 'recover transient failure',
      attachmentIds: [],
    });

    expect(await terminalEvent).toBe('completed');
    expect(attemptCount).toBe(2);
    expect(events).toEqual(['started', 'delta', 'completed']);
    expect(harness.chatStore.findRunById(response.runId)?.status).toBe('succeeded');
    expect(harness.chatStore.findMessageById(response.assistantMessageId)).toMatchObject({
      status: 'completed',
      content: 'recovered',
    });
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('recovers from a short Provider outage spanning multiple 503 attempts', async () => {
    vi.useFakeTimers();
    try {
      let attemptCount = 0;
      const harness = createChatServiceHarness(async function* () {
        attemptCount += 1;
        if (attemptCount <= 3) {
          throw new SummaryError(
            SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_REQUEST_FAILED,
            'The provider request failed with status 503.',
            true,
          );
        }
        yield 'recovered after outage';
      });
      const terminalEvent = new Promise<string>((resolve) => {
        harness.service.subscribe((event) => {
          if (event.type === 'completed' || event.type === 'failed') {
            resolve(event.type);
          }
        });
      });

      const response = await harness.service.send({
        operationId: 'repeated-outage',
        entryId: 1,
        question: 'recover repeated transient failures',
        attachmentIds: [],
      });
      await vi.runAllTimersAsync();

      expect(await terminalEvent).toBe('completed');
      expect(attemptCount).toBe(4);
      expect(harness.chatStore.findRunById(response.runId)?.status)
        .toBe('succeeded');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels immediately while waiting to retry a transient Provider failure', async () => {
    vi.useFakeTimers();
    try {
      let attemptCount = 0;
      let markFirstAttemptFailed: () => void = () => undefined;
      const firstAttemptFailed = new Promise<void>((resolve) => {
        markFirstAttemptFailed = resolve;
      });
      const harness = createChatServiceHarness(async function* () {
        attemptCount += 1;
        markFirstAttemptFailed();
        yield await Promise.reject<string>(new SummaryError(
          SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_REQUEST_FAILED,
          'The provider request failed with status 503.',
          true,
        ));
      });
      const response = await harness.service.send({
        operationId: 'cancel-retry-delay',
        entryId: 1,
        question: 'cancel during retry delay',
        attachmentIds: [],
      });
      await firstAttemptFailed;

      harness.service.cancel({ runId: response.runId });
      await vi.runAllTimersAsync();

      expect(attemptCount).toBe(1);
      expect(harness.chatStore.findRunById(response.runId)?.status)
        .toBe('interrupted');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry after answer text has already been emitted', async () => {
    let attemptCount = 0;
    const harness = createChatServiceHarness(async function* () {
      attemptCount += 1;
      yield 'partial';
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_REQUEST_FAILED,
        'The upstream Provider failed after output started.',
        true,
      );
    });
    const terminalEvent = new Promise<string>((resolve) => {
      harness.service.subscribe((event) => {
        if (event.type === 'completed' || event.type === 'failed') {
          resolve(event.type);
        }
      });
    });

    const response = await harness.service.send({
      operationId: 'timeout-retry',
      entryId: 1,
      question: 'do not duplicate output',
      attachmentIds: [],
    });

    expect(await terminalEvent).toBe('failed');
    expect(attemptCount).toBe(1);
    expect(harness.chatStore.findMessageById(response.assistantMessageId)).toMatchObject({
      status: 'failed',
      content: 'partial',
    });
  });

  it('retries a failed run without duplicating the user message', async () => {
    let attempt = 0;
    const harness = createChatServiceHarness(async function* () {
      attempt += 1;
      if (attempt === 1) throw new Error('provider failed');
      yield 'recovered';
    });
    const failedEvent = new Promise<void>((resolve) => {
      harness.service.subscribe((event) => {
        if (event.type === 'failed') resolve();
      });
    });
    const first = await harness.service.send({
      operationId: 'retry-source',
      entryId: 1,
      question: 'retry me',
      attachmentIds: [],
    });
    await failedEvent;
    expect(harness.chatStore.findRunById(first.runId)?.status).toBe('failed');

    const completedEvent = new Promise<void>((resolve) => {
      harness.service.subscribe((event) => {
        if (event.type === 'completed') resolve();
      });
    });
    const retried = await harness.service.retry({
      operationId: 'retry-attempt',
      runId: first.runId,
    });
    await completedEvent;

    expect(retried).toMatchObject({ runId: first.runId, reused: true });
    expect(harness.chatStore.listMessages(retried.threadId)).toMatchObject([
      { role: 'user', content: 'retry me' },
      { role: 'assistant', content: 'recovered', status: 'completed' },
    ]);
  });

  it('regenerates an edited user turn and removes its old visible suffix', async () => {
    const questions: string[] = [];
    let answerNumber = 0;
    const harness = createChatServiceHarness(async function* (request) {
      const questionMessage = request.messages?.[request.messages.length - 1];
      const questionPart = questionMessage?.content.find(
        (part) => part.type === 'text',
      );
      questions.push(questionPart?.type === 'text' ? questionPart.text : '');
      answerNumber += 1;
      yield `answer-${answerNumber}`;
    });

    const firstCompleted = waitForChatCompletion(harness.service);
    const first = await harness.service.send({
      operationId: 'regenerate-source',
      entryId: 1,
      question: 'Original question',
      attachmentIds: [],
    });
    await firstCompleted;
    const followUpCompleted = waitForChatCompletion(harness.service);
    await harness.service.send({
      operationId: 'regenerate-follow-up',
      entryId: 1,
      question: 'Follow-up question',
      attachmentIds: [],
    });
    await followUpCompleted;

    const regeneratedCompleted = waitForChatCompletion(harness.service);
    const regenerated = await harness.service.regenerate({
      operationId: 'regenerate-attempt',
      userMessageId: first.userMessageId,
      question: 'Edited question',
    });
    await regeneratedCompleted;

    expect(regenerated).toMatchObject({ reused: false });
    expect(regenerated.userMessageId).not.toBe(first.userMessageId);
    expect(questions).toEqual([
      'Original question',
      'Follow-up question',
      'Edited question',
    ]);
    expect(harness.service.getState({ entryId: 1 })).toMatchObject({
      state: 'idle',
      messages: [
        { role: 'user', content: 'Edited question' },
        { role: 'assistant', content: 'answer-3', status: 'completed' },
      ],
    });
  });

  it('interrupts the active run when the current article changes', async () => {
    const harness = createChatServiceHarness(async function* () {
      await new Promise((resolve) => setTimeout(resolve, 30));
      yield 'late';
    });
    const response = await harness.service.send({
      operationId: 'article-change',
      entryId: 1,
      question: 'switch article',
      attachmentIds: [],
    });

    harness.service.handleEntryChange(2);

    await vi.waitFor(() => {
      expect(harness.chatStore.findRunById(response.runId)?.status)
        .toBe('interrupted');
    });
  });

  it('loads a persisted normalized image into a multimodal Provider request', async () => {
    const harness = createImageChatHarness(true);
    const thread = harness.service.getState({ entryId: 1 }).thread;
    const attachment = harness.chatStore.createImageAttachment({
      threadId: thread.id,
      displayName: 'evidence.png',
      mimeType: 'image/png',
      byteSize: 3,
      contentHash: 'image-hash',
      storageKey: `${'a'.repeat(64)}.png`,
      width: 20,
      height: 10,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    const completed = new Promise<void>((resolve) => {
      harness.service.subscribe((event) => {
        if (event.type === 'completed') resolve();
      });
    });

    await harness.service.send({
      operationId: 'image-chat',
      entryId: 1,
      question: 'What does this image show?',
      attachmentIds: [attachment.id],
    });
    await completed;

    expect(harness.readImage).toHaveBeenCalledWith(
      expect.objectContaining({ id: attachment.id }),
    );
    expect(harness.providerStream).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({
          content: expect.arrayContaining([
            {
              type: 'image',
              mimeType: 'image/png',
              bytes: Uint8Array.from([1, 2, 3]),
            },
          ]),
        }),
      ]),
    }));
  });

  it('rejects an image before Provider execution when the Chat model is text-only', async () => {
    const harness = createImageChatHarness(false);
    const thread = harness.service.getState({ entryId: 1 }).thread;
    const attachment = harness.chatStore.createImageAttachment({
      threadId: thread.id,
      displayName: 'evidence.jpg',
      mimeType: 'image/jpeg',
      byteSize: 3,
      contentHash: 'image-hash',
      storageKey: `${'b'.repeat(64)}.jpg`,
      width: 20,
      height: 10,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    await expect(harness.service.send({
      operationId: 'image-unsupported',
      entryId: 1,
      question: 'Read this image',
      attachmentIds: [attachment.id],
    })).rejects.toMatchObject({
      code: 'CHAT_IMAGE_UNSUPPORTED',
    });
    expect(harness.providerStream).not.toHaveBeenCalled();
    expect(harness.chatStore.listDraftAttachments(thread.id)).toMatchObject([
      { id: attachment.id },
    ]);
  });

  it('persists a failed reserved run when context preparation fails', async () => {
    const providerStream = vi.fn(async function* () {
      yield 'unreachable';
    });
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const harness = createChatServiceHarness(
      providerStream,
      async () => {
        throw new ChatError(
          CHAT_ERROR_CODES.CHAT_CONTEXT_TOO_LARGE,
          'The required context does not fit.',
          false,
        );
      },
      logger,
    );

    await expect(harness.service.send({
      operationId: 'context-failure',
      entryId: 1,
      question: 'Explain the complete article.',
      attachmentIds: [],
    })).rejects.toMatchObject({
      code: CHAT_ERROR_CODES.CHAT_CONTEXT_TOO_LARGE,
    });

    expect(providerStream).not.toHaveBeenCalled();
    expect(harness.service.getState({ entryId: 1 })).toMatchObject({
      state: 'failed',
      messages: [
        { role: 'user', content: 'Explain the complete article.' },
        { role: 'assistant', status: 'failed' },
      ],
      run: {
        status: 'failed',
        error: { code: CHAT_ERROR_CODES.CHAT_CONTEXT_TOO_LARGE },
      },
    });
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      CHAT_LOG_EVENTS.runFailed,
      'chat.run',
      expect.objectContaining({
        operation: 'send',
        finalFailureStage: 'context-preparation',
        taskRunId: expect.any(Number),
        success: false,
        errorCode: CHAT_ERROR_CODES.CHAT_CONTEXT_TOO_LARGE,
      }),
    );
  });

  it('records one session terminal when conversation loading fails', () => {
    const logger = createChatLoggerDouble();
    const harness = createChatServiceHarness(async function* () {
      yield 'unused';
    }, undefined, logger);
    vi.spyOn(harness.chatStore, 'findOrCreateThread').mockImplementation(() => {
      throw new Error('SQLITE_PRIVATE_LOAD_CANARY');
    });

    expect(() => harness.service.getState({ entryId: 1 })).toThrow();

    expectSingleChatFailure(logger, CHAT_LOG_EVENTS.sessionPersistenceFailed, {
      operation: 'load',
      finalFailureStage: 'session-load',
      errorCode: 'CHAT_SESSION_PERSISTENCE_FAILED',
    });
  });

  it('records one session terminal when reserving messages and a run fails', async () => {
    const logger = createChatLoggerDouble();
    const harness = createChatServiceHarness(async function* () {
      yield 'unused';
    }, undefined, logger);
    vi.spyOn(harness.chatStore, 'createRunWithMessages').mockImplementation(() => {
      throw new Error('SQLITE_PRIVATE_RESERVE_CANARY');
    });

    await expect(harness.service.send({
      operationId: 'reserve-failure',
      entryId: 1,
      question: 'private question canary',
      attachmentIds: [],
    })).rejects.toThrow();

    expectSingleChatFailure(logger, CHAT_LOG_EVENTS.sessionPersistenceFailed, {
      operation: 'send',
      finalFailureStage: 'run-reserve',
      errorCode: 'CHAT_SESSION_PERSISTENCE_FAILED',
    });
  });

  it('records one session terminal when finalizing prepared context fails', async () => {
    const logger = createChatLoggerDouble();
    const harness = createChatServiceHarness(async function* () {
      yield 'unused';
    }, undefined, logger);
    vi.spyOn(harness.chatStore, 'finalizeRunContext').mockImplementation(() => {
      throw new Error('SQLITE_PRIVATE_CONTEXT_FINALIZE_CANARY');
    });

    await expect(harness.service.send({
      operationId: 'finalize-failure',
      entryId: 1,
      question: 'private question canary',
      attachmentIds: [],
    })).rejects.toThrow();

    expectSingleChatFailure(logger, CHAT_LOG_EVENTS.sessionPersistenceFailed, {
      operation: 'send',
      finalFailureStage: 'context-finalize',
      errorCode: 'CHAT_SESSION_PERSISTENCE_FAILED',
    });
  });

  it('records one session terminal when appending a streamed delta fails', async () => {
    const logger = createChatLoggerDouble();
    const harness = createChatServiceHarness(async function* () {
      yield 'PRIVATE_DELTA_CANARY';
    }, undefined, logger);
    vi.spyOn(harness.chatStore, 'appendAssistantDelta').mockImplementation(() => {
      throw new Error('SQLITE_PRIVATE_APPEND_CANARY');
    });

    await harness.service.send({
      operationId: 'delta-failure',
      entryId: 1,
      question: 'private question canary',
      attachmentIds: [],
    });
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledOnce());

    expectSingleChatFailure(logger, CHAT_LOG_EVENTS.sessionPersistenceFailed, {
      operation: 'send',
      finalFailureStage: 'delta-append',
      errorCode: 'CHAT_SESSION_PERSISTENCE_FAILED',
    });
  });

  it('records one session terminal when successful run finalization fails', async () => {
    const logger = createChatLoggerDouble();
    const harness = createChatServiceHarness(async function* () {
      yield 'answer';
    }, undefined, logger);
    vi.spyOn(harness.chatStore, 'markRunSucceeded').mockImplementation(() => {
      throw new Error('SQLITE_PRIVATE_FINALIZE_CANARY');
    });

    await harness.service.send({
      operationId: 'success-finalize-failure',
      entryId: 1,
      question: 'private question canary',
      attachmentIds: [],
    });
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledOnce());

    expectSingleChatFailure(logger, CHAT_LOG_EVENTS.sessionPersistenceFailed, {
      operation: 'send',
      finalFailureStage: 'run-finalize',
      errorCode: 'CHAT_SESSION_PERSISTENCE_FAILED',
    });
  });

  it('records one session terminal when failed-state persistence fails', async () => {
    const logger = createChatLoggerDouble();
    const harness = createChatServiceHarness(async function* () {
      yield 'partial';
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_AUTH,
        'RAW_PROVIDER_ERROR_CANARY',
        false,
      );
    }, undefined, logger);
    vi.spyOn(harness.chatStore, 'markRunFailed').mockImplementation(() => {
      throw new Error('SQLITE_PRIVATE_FAIL_CANARY');
    });

    await harness.service.send({
      operationId: 'failed-state-failure',
      entryId: 1,
      question: 'private question canary',
      attachmentIds: [],
    });
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledOnce());

    expectSingleChatFailure(logger, CHAT_LOG_EVENTS.sessionPersistenceFailed, {
      operation: 'send',
      finalFailureStage: 'run-fail',
      errorCode: 'CHAT_SESSION_PERSISTENCE_FAILED',
    });
  });

  it('lets a context failure-persistence fault own the single terminal', async () => {
    const logger = createChatLoggerDouble();
    const harness = createChatServiceHarness(
      async function* () {
        yield 'unused';
      },
      async () => {
        throw new ChatError(
          CHAT_ERROR_CODES.CHAT_CONTEXT_TOO_LARGE,
          'PRIVATE_CONTEXT_CANARY',
          false,
        );
      },
      logger,
    );
    vi.spyOn(harness.chatStore, 'markRunFailed').mockImplementation(() => {
      throw new Error('SQLITE_PRIVATE_FAIL_CANARY');
    });

    await expect(harness.service.send({
      operationId: 'context-persistence-failure',
      entryId: 1,
      question: 'private question canary',
      attachmentIds: [],
    })).rejects.toThrow();

    expectSingleChatFailure(logger, CHAT_LOG_EVENTS.sessionPersistenceFailed, {
      operation: 'send',
      finalFailureStage: 'run-fail',
      errorCode: 'CHAT_SESSION_PERSISTENCE_FAILED',
    });
  });

  it('keeps one run terminal when a failure listener throws', async () => {
    const logger = createChatLoggerDouble();
    const harness = createChatServiceHarness(async function* () {
      yield 'partial';
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_AUTH,
        'RAW_PROVIDER_ERROR_CANARY',
        false,
      );
    }, undefined, logger);
    harness.service.subscribe((event) => {
      if (event.type === 'failed') throw new Error('LISTENER_PRIVATE_CANARY');
    });

    await harness.service.send({
      operationId: 'listener-failure',
      entryId: 1,
      question: 'private question canary',
      attachmentIds: [],
    });
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledOnce());

    expectSingleChatFailure(logger, CHAT_LOG_EVENTS.runFailed, {
      operation: 'send',
      finalFailureStage: 'provider',
      errorCode: CHAT_ERROR_CODES.CHAT_PROVIDER_AUTH,
    });
  });

  it('does not log user stop, article change, or normal shutdown', async () => {
    for (const interrupt of [
      (service: ChatService, runId: number) => service.cancel({ runId }),
      (service: ChatService) => service.handleEntryChange(2),
      (service: ChatService) => service.abortActiveRun(),
    ]) {
      const logger = createChatLoggerDouble();
      const harness = createChatServiceHarness(async function* () {
        await new Promise((resolve) => setTimeout(resolve, 20));
        yield 'late';
      }, undefined, logger);
      const response = await harness.service.send({
        operationId: 'normal-interruption',
        entryId: 1,
        question: 'stop normally',
        attachmentIds: [],
      });

      interrupt(harness.service, response.runId);
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(harness.chatStore.findRunById(response.runId)?.status)
        .toBe('interrupted');
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    }
  });

  it('cancels send during context preparation without answer Provider usage or failure logs', async () => {
    const preparation = createDeferredPreparation();
    const logger = createChatLoggerDouble();
    const usageRecorder = createUsageRecorderDouble();
    const providerStream = vi.fn(async function* () {
      yield 'unreachable';
    });
    const harness = createChatServiceHarness(
      providerStream,
      preparation.prepare,
      logger,
      usageRecorder,
    );

    const sending = harness.service.send({
      operationId: 'prepare-send-cancel',
      entryId: 1,
      question: 'stop before the answer request',
      attachmentIds: [],
    });
    await preparation.started;

    harness.service.cancel({ operationId: 'prepare-send-cancel' });
    preparation.release();

    await expect(sending).rejects.toMatchObject({
      code: CHAT_ERROR_CODES.CHAT_INTERRUPTED,
    });
    expect(providerStream).not.toHaveBeenCalled();
    expect(usageRecorder.start).not.toHaveBeenCalled();
    expect(harness.service.getState({ entryId: 1 })).toMatchObject({
      state: 'interrupted',
      run: { status: 'interrupted' },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    ['article change', (service: ChatService) => service.handleEntryChange(2)],
    ['normal shutdown', (service: ChatService) => service.abortActiveRun()],
  ])('cancels preparation on %s before the Provider starts', async (_label, interrupt) => {
    const preparation = createDeferredPreparation();
    const providerStream = vi.fn(async function* () {
      yield 'unreachable';
    });
    const harness = createChatServiceHarness(providerStream, preparation.prepare);
    const sending = harness.service.send({
      operationId: `prepare-${String(_label)}`,
      entryId: 1,
      question: 'lifecycle cancellation',
      attachmentIds: [],
    });
    await preparation.started;

    interrupt(harness.service);
    preparation.release();

    await expect(sending).rejects.toMatchObject({
      code: CHAT_ERROR_CODES.CHAT_INTERRUPTED,
    });
    expect(providerStream).not.toHaveBeenCalled();
  });

  it('cancels retry and regenerate while their context is being prepared', async () => {
    let prepareCount = 0;
    let releasePreparation: (() => void) | undefined;
    let preparationStarted: (() => void) | undefined;
    const waitingForPreparation = new Promise<void>((resolve) => {
      preparationStarted = resolve;
    });
    const prepare = vi.fn(async (request: PrepareArticleContextRequest) => {
      prepareCount += 1;
      if (prepareCount > 1) {
        preparationStarted?.();
        await new Promise<void>((resolve) => {
          releasePreparation = resolve;
        });
        request.signal.throwIfAborted();
      }
      return preparedContext();
    });
    let providerCalls = 0;
    const harness = createChatServiceHarness(async function* () {
      providerCalls += 1;
      yield `answer-${providerCalls}`;
    }, prepare);
    const completed = waitForChatCompletion(harness.service);
    const first = await harness.service.send({
      operationId: 'prepare-regenerate-source',
      entryId: 1,
      question: 'source question',
      attachmentIds: [],
    });
    await completed;

    const regenerating = harness.service.regenerate({
      operationId: 'prepare-regenerate-cancel',
      userMessageId: first.userMessageId,
    });
    await waitingForPreparation;
    harness.service.cancel({ operationId: 'prepare-regenerate-cancel' });
    releasePreparation?.();
    await expect(regenerating).rejects.toMatchObject({
      code: CHAT_ERROR_CODES.CHAT_INTERRUPTED,
    });
    expect(providerCalls).toBe(1);

    const interruptedRun = harness.service.getState({ entryId: 1 });
    expect(interruptedRun.state).toBe('interrupted');
    if (interruptedRun.state !== 'interrupted') throw new Error('Expected interrupted run.');

    let releaseRetry: (() => void) | undefined;
    let retryStarted: (() => void) | undefined;
    const waitingForRetry = new Promise<void>((resolve) => {
      retryStarted = resolve;
    });
    prepare.mockImplementationOnce(async (request) => {
      retryStarted?.();
      await new Promise<void>((resolve) => {
        releaseRetry = resolve;
      });
      request.signal.throwIfAborted();
      return preparedContext();
    });
    const retrying = harness.service.retry({
      operationId: 'prepare-retry-cancel',
      runId: interruptedRun.run.id,
    });
    await waitingForRetry;
    harness.service.cancel({ operationId: 'prepare-retry-cancel' });
    releaseRetry?.();

    await expect(retrying).rejects.toMatchObject({
      code: CHAT_ERROR_CODES.CHAT_INTERRUPTED,
    });
    expect(providerCalls).toBe(1);
  });

  it('lets cancellation win the preparation-completion race without reviving the run', async () => {
    const preparation = createDeferredPreparation();
    const providerStream = vi.fn(async function* () {
      yield 'unreachable';
    });
    const harness = createChatServiceHarness(providerStream, preparation.prepare);
    const sending = harness.service.send({
      operationId: 'prepare-race',
      entryId: 1,
      question: 'race preparation completion',
      attachmentIds: [],
    });
    await preparation.started;

    preparation.release();
    harness.service.cancel({ operationId: 'prepare-race' });

    await expect(sending).rejects.toMatchObject({
      code: CHAT_ERROR_CODES.CHAT_INTERRUPTED,
    });
    expect(providerStream).not.toHaveBeenCalled();
    expect(harness.service.getState({ entryId: 1 })).toMatchObject({
      state: 'interrupted',
    });
  });

  it('does not let a late operation cleanup cancel a newer run', async () => {
    const firstPreparation = createDeferredPreparation();
    const secondPreparation = createDeferredPreparation();
    const prepare = vi.fn()
      .mockImplementationOnce(firstPreparation.prepare)
      .mockImplementationOnce(secondPreparation.prepare);
    const providerStream = vi.fn(async function* () {
      yield 'new answer';
    });
    const harness = createChatServiceHarness(providerStream, prepare);
    const first = harness.service.send({
      operationId: 'old-operation',
      entryId: 1,
      question: 'old request',
      attachmentIds: [],
    });
    await firstPreparation.started;
    harness.service.cancel({ operationId: 'old-operation' });
    firstPreparation.release();
    await expect(first).rejects.toMatchObject({
      code: CHAT_ERROR_CODES.CHAT_INTERRUPTED,
    });

    const completed = waitForChatCompletion(harness.service);
    const second = harness.service.send({
      operationId: 'new-operation',
      entryId: 1,
      question: 'new request',
      attachmentIds: [],
    });
    await secondPreparation.started;
    expect(() => harness.service.cancel({ operationId: 'old-operation' }))
      .toThrowError(ChatError);
    secondPreparation.release();
    await second;
    await completed;

    expect(providerStream).toHaveBeenCalledOnce();
    expect(harness.service.getState({ entryId: 1 })).toMatchObject({ state: 'idle' });
  });

  it('keeps a real preparation failure when cancellation arrives after rejection', async () => {
    let rejectPreparation: ((error: Error) => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const logger = createChatLoggerDouble();
    const harness = createChatServiceHarness(
      async function* () {
        yield 'unreachable';
      },
      async () => {
        markStarted?.();
        return await new Promise<PreparedArticleContext>((_resolve, reject) => {
          rejectPreparation = reject;
        });
      },
      logger,
    );
    const sending = harness.service.send({
      operationId: 'real-failure-before-cancel',
      entryId: 1,
      question: 'preserve the real failure',
      attachmentIds: [],
    });
    await started;

    rejectPreparation?.(new Error('PRIVATE_CONTEXT_FAILURE'));
    harness.service.cancel({ operationId: 'real-failure-before-cancel' });

    await expect(sending).rejects.toThrow('PRIVATE_CONTEXT_FAILURE');
    expect(harness.service.getState({ entryId: 1 })).toMatchObject({
      state: 'failed',
      run: { error: { code: CHAT_ERROR_CODES.CHAT_UNKNOWN_ERROR } },
    });
    expectSingleChatFailure(logger, CHAT_LOG_EVENTS.runFailed, {
      operation: 'send',
      finalFailureStage: 'context-preparation',
      errorCode: CHAT_ERROR_CODES.CHAT_UNKNOWN_ERROR,
    });
  });
});

function createImageChatHarness(supportsImages: boolean): {
  service: ChatService;
  chatStore: ChatStore;
  providerStream: ReturnType<typeof vi.fn>;
  readImage: ReturnType<typeof vi.fn>;
} {
  const { db } = buildTestDbWithData();
  const contentStore = new ContentStore(db);
  contentStore.upsert({
    entryId: 1,
    markdown: 'Article body',
    sourceContentHash: 'article-hash',
    pipelineStatus: 'success',
  });
  const profileStore = new ProviderProfileStore(db);
  profileStore.saveActive({
    summary: {
      providerKind: 'openai',
      baseUrl: 'https://provider.test/v1',
      model: 'summary-model',
      apiKeyRef: 'summary-key',
    },
    translation: {
      providerKind: 'openai',
      baseUrl: 'https://provider.test/v1',
      model: 'translation-model',
      apiKeyRef: 'translation-key',
    },
    tag: {
      providerKind: 'openai',
      baseUrl: 'https://provider.test/v1',
      model: 'tag-model',
      apiKeyRef: 'tag-key',
    },
    chat: {
      providerKind: 'openai',
      baseUrl: 'https://provider.test/v1',
      model: 'chat-model',
      apiKeyRef: 'chat-key',
      supportsImages,
    },
  });
  const providerStream = vi.fn(async function* () {
    yield 'Image answer';
  });
  const provider: TextGenerationProvider = {
    stream: providerStream,
    testConnection: () => Promise.resolve(),
  };
  const chatStore = new ChatStore(db);
  const readImage = vi.fn(() => Uint8Array.from([1, 2, 3]));
  return {
    service: new ChatService(
      contentStore,
      profileStore,
      { read: () => 'secret' },
      chatStore,
      {
        prepare: async () => ({
          mode: 'full',
          systemInstruction: 'system',
          articleReference: 'article',
          historyReference: '',
          estimatedPromptTokens: 2,
          cacheHit: false,
          relatedSegmentIds: [],
        }),
      },
      provider,
      { readImage },
    ),
    chatStore,
    providerStream,
    readImage,
  };
}

function waitForChatCompletion(service: ChatService): Promise<void> {
  return new Promise<void>((resolve) => {
    const unsubscribe = service.subscribe((event) => {
      if (event.type !== 'completed') return;
      unsubscribe();
      resolve();
    });
  });
}

function createChatServiceHarness(
  stream: TextGenerationProvider['stream'],
  prepare: (
    request: PrepareArticleContextRequest,
  ) => Promise<PreparedArticleContext> = async () => ({
    mode: 'full',
    systemInstruction: 'system',
    articleReference: 'article',
    historyReference: '',
    estimatedPromptTokens: 2,
    cacheHit: false,
    relatedSegmentIds: [],
  }),
  logger?: ChatOperationLogger,
  usageRecorder?: UsageRecorderPort,
): {
  service: ChatService;
  chatStore: ChatStore;
} {
  const { db } = buildTestDbWithData();
  const contentStore = new ContentStore(db);
  contentStore.upsert({
    entryId: 1,
    markdown: 'Article body',
    sourceContentHash: 'article-hash',
    pipelineStatus: 'success',
  });
  const profileStore = new ProviderProfileStore(db);
  profileStore.saveActive({
    providerKind: 'openai',
    baseUrl: 'https://provider.test/v1',
    model: 'chat-model',
    apiKeyRef: 'chat-key',
  });
  const provider: TextGenerationProvider = {
    stream,
    testConnection: () => Promise.resolve(),
  };
  const chatStore = new ChatStore(db);
  return {
    chatStore,
    service: new ChatService(
      contentStore,
      profileStore,
      { read: () => 'secret' },
      chatStore,
      { prepare },
      provider,
      undefined,
      usageRecorder,
      logger,
    ),
  };
}

function createChatLoggerDouble() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function preparedContext(): PreparedArticleContext {
  return {
    mode: 'full',
    systemInstruction: 'system',
    articleReference: 'article',
    historyReference: '',
    estimatedPromptTokens: 2,
    cacheHit: false,
    relatedSegmentIds: [],
  };
}

function createDeferredPreparation(): {
  prepare: (request: PrepareArticleContextRequest) => Promise<PreparedArticleContext>;
  started: Promise<void>;
  release: () => void;
} {
  let markStarted = (): void => undefined;
  let releasePreparation = (): void => undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const preparationGate = new Promise<void>((resolve) => {
    releasePreparation = resolve;
  });

  return {
    started,
    release: releasePreparation,
    prepare: async (request) => {
      markStarted();
      await preparationGate;
      request.signal.throwIfAborted();
      return preparedContext();
    },
  };
}

function createUsageRecorderDouble() {
  return {
    start: vi.fn((params: StartUsageRequestParams): UsageRequestHandle => ({
      providerRequestId: params.providerRequestId,
      attemptId: params.attemptId,
      taskRunId: params.taskRunId,
      persisted: true,
      settled: false,
    })),
    complete: vi.fn<UsageRecorderPort['complete']>(),
    fail: vi.fn<UsageRecorderPort['fail']>(),
    interrupt: vi.fn<UsageRecorderPort['interrupt']>(),
    reconcileInterruptedRunning: vi.fn(() => 0),
    listByAttempt: vi.fn(() => []),
  };
}

function expectSingleChatFailure(
  logger: ReturnType<typeof createChatLoggerDouble>,
  event: (typeof CHAT_LOG_EVENTS)[keyof typeof CHAT_LOG_EVENTS],
  context: Record<string, unknown>,
): void {
  expect(logger.info).not.toHaveBeenCalled();
  expect(logger.warn).not.toHaveBeenCalled();
  expect(logger.error).toHaveBeenCalledOnce();
  expect(logger.error).toHaveBeenCalledWith(
    event,
    expect.stringMatching(/^chat\./),
    expect.objectContaining({
      ...context,
      durationMs: expect.any(Number),
      success: false,
    }),
  );
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('CANARY');
}
