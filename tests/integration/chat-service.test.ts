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
  UsageRequestHandle,
} from '../../src/main/ai/services/UsageRecorder';
import {
  CHAT_ERROR_CODES,
  ChatError,
} from '../../src/shared/errors/chat.errors';

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
        yield 'First ';
        yield 'answer.';
      },
      testConnection: () => Promise.resolve(),
    };
    const chatStore = new ChatStore(db);
    const prepare = vi.fn(async () => ({
      mode: 'full' as const,
      systemInstruction: 'You are Shale Article Guide.',
      articleReference: '<article-context>Article body</article-context>',
      historyReference: '',
      estimatedPromptTokens: 20,
      cacheHit: false,
      relatedSegmentIds: [],
    }));
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

    await service.send({ entryId: 1, question: 'first', attachmentIds: [] });
    await expect(service.send({
      entryId: 1,
      question: 'second',
      attachmentIds: [],
    })).rejects.toMatchObject({ code: 'CHAT_BUSY' });
    release?.();
  });

  it('cancels an active run and ignores late Provider output', async () => {
    const harness = createChatServiceHarness(async function* () {
      await new Promise((resolve) => setTimeout(resolve, 20));
      yield 'late';
    });
    const events: string[] = [];
    harness.service.subscribe((event) => events.push(event.type));
    const response = await harness.service.send({
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
    const retried = await harness.service.retry({ runId: first.runId });
    await completedEvent;

    expect(retried).toMatchObject({ runId: first.runId, reused: true });
    expect(harness.chatStore.listMessages(retried.threadId)).toMatchObject([
      { role: 'user', content: 'retry me' },
      { role: 'assistant', content: 'recovered', status: 'completed' },
    ]);
  });

  it('interrupts the active run when the current article changes', async () => {
    const harness = createChatServiceHarness(async function* () {
      await new Promise((resolve) => setTimeout(resolve, 30));
      yield 'late';
    });
    const response = await harness.service.send({
      entryId: 1,
      question: 'switch article',
      attachmentIds: [],
    });

    harness.service.handleEntryChange(2);

    expect(harness.chatStore.findRunById(response.runId)?.status).toBe('interrupted');
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
    const harness = createChatServiceHarness(
      providerStream,
      async () => {
        throw new ChatError(
          CHAT_ERROR_CODES.CHAT_CONTEXT_TOO_LARGE,
          'The required context does not fit.',
          false,
        );
      },
    );

    await expect(harness.service.send({
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
    ),
  };
}
