import { createHash } from 'node:crypto';
import type { CleanedContent } from '../../../shared/contracts/content.types';
import type {
  ChatCancelRequest,
  ChatClearRequest,
  ChatGetRequest,
  ChatSendRequest,
  ChatSendResponse,
  ChatState,
  ChatStreamEvent,
} from '../../../shared/contracts/chat.types';
import {
  CHAT_ERROR_CODES,
  ChatError,
  toChatIpcError,
} from '../../../shared/errors/chat.errors';
import type { ProviderProfileStore } from '../stores/ProviderProfileStore';
import type { SecretStore } from '../stores/SecretStore';
import type {
  ProviderMessage,
  TextGenerationProvider,
} from '../provider/TextGenerationProvider';
import {
  buildArticleChatSystemInstruction,
  CHAT_MAX_CONTEXT_CHARACTERS,
  CHAT_PROMPT_VERSION,
} from '../provider/ChatPrompt';
import { ChatStore, type ChatThread } from '../stores/ChatStore';

interface ChatContentLookup {
  findByEntry(entryId: number): CleanedContent | undefined;
}

interface ActiveChatRun {
  run: ReturnType<ChatStore['createTurn']>['run'];
  abortController: AbortController;
}

export class ChatService {
  private activeRun: ActiveChatRun | null = null;
  private readonly listeners = new Set<(event: ChatStreamEvent) => void>();

  constructor(
    private readonly contentLookup: ChatContentLookup,
    private readonly profileStore: ProviderProfileStore,
    private readonly secretStore: SecretStore,
    private readonly chatStore: ChatStore,
    private readonly provider: TextGenerationProvider,
  ) {}

  subscribe(listener: (event: ChatStreamEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(request: ChatGetRequest): ChatState {
    validateEntryId(request.entryId);
    const content = this.requireContent(request.entryId);
    const thread = this.findThread(request.entryId, content);
    if (!thread) return { entryId: request.entryId, messages: [] };
    return {
      entryId: request.entryId,
      threadId: thread.id,
      messages: this.chatStore.listMessages(thread.id),
      activeRun: this.chatStore.findRunningRun(thread.id),
    };
  }

  send(request: ChatSendRequest): ChatSendResponse {
    validateEntryId(request.entryId);
    const question = request.question.trim();
    if (!question || question.length > 8_000) {
      throw new ChatError(
        CHAT_ERROR_CODES.invalidRequest,
        '问题不能为空，且长度不能超过 8000 个字符。',
        false,
      );
    }
    if (this.activeRun) {
      throw new ChatError(
        CHAT_ERROR_CODES.busy,
        '已有一个 AI 问答正在生成，请先等待或停止它。',
        true,
      );
    }

    const content = this.requireContent(request.entryId);
    const profile = this.profileStore.findActiveWithSecret();
    if (!profile?.chatApiKeyRef) {
      throw new ChatError(
        CHAT_ERROR_CODES.providerNotConfigured,
        '请先在设置中配置 AI 问答 Provider。',
        false,
      );
    }
    const apiKey = this.secretStore.read(profile.chatApiKeyRef);
    const thread = this.chatStore.getOrCreateThread(
      request.entryId,
      contentHash(content),
      CHAT_PROMPT_VERSION,
    );
    const history = successfulProviderMessages(
      this.chatStore.listMessages(thread.id),
    );
    const systemInstruction = buildArticleChatSystemInstruction(content);
    const contextCharacters = systemInstruction.length
      + history.reduce((sum, message) => sum + message.content.length, 0)
      + question.length;
    if (contextCharacters > CHAT_MAX_CONTEXT_CHARACTERS) {
      throw new ChatError(
        CHAT_ERROR_CODES.contextTooLarge,
        '文章和完整对话超过当前问答上下文上限，请清空对话后重试。',
        false,
      );
    }

    const turn = this.chatStore.createTurn(thread, profile.id, question);
    const abortController = new AbortController();
    this.activeRun = { run: turn.run, abortController };
    this.emit({
      type: 'started',
      runId: turn.run.id,
      threadId: thread.id,
      entryId: request.entryId,
      messageId: turn.assistantMessage.id,
    });
    void this.execute(
      turn.run,
      systemInstruction,
      [...history, { role: 'user', content: question }],
      {
        providerKind: profile.chatProviderKind,
        baseUrl: profile.chatBaseUrl,
        model: profile.chatModel,
        apiKey,
        signal: abortController.signal,
      },
    );
    return {
      runId: turn.run.id,
      threadId: thread.id,
      userMessageId: turn.userMessage.id,
      assistantMessageId: turn.assistantMessage.id,
    };
  }

  cancel(request: ChatCancelRequest): void {
    if (!Number.isInteger(request.runId) || request.runId <= 0) {
      throw new ChatError(
        CHAT_ERROR_CODES.invalidRequest,
        '停止问答请求无效。',
        false,
      );
    }
    const active = this.activeRun;
    if (!active || active.run.id !== request.runId) return;
    active.abortController.abort();
    const error = toChatIpcError(new ChatError(
      CHAT_ERROR_CODES.interrupted,
      'AI 问答已停止。',
      true,
    ));
    this.chatStore.markFailed(active.run, error, true);
    this.emit({
      type: 'failed',
      runId: active.run.id,
      threadId: active.run.threadId,
      entryId: active.run.entryId,
      messageId: active.run.assistantMessageId,
      error,
    });
    this.activeRun = null;
  }

  clear(request: ChatClearRequest): void {
    validateEntryId(request.entryId);
    if (this.activeRun?.run.entryId === request.entryId) {
      throw new ChatError(
        CHAT_ERROR_CODES.busy,
        '请先停止当前回答，再清空对话。',
        true,
      );
    }
    const content = this.requireContent(request.entryId);
    const thread = this.findThread(request.entryId, content);
    if (thread) this.chatStore.clearThread(thread.id);
  }

  close(): void {
    if (this.activeRun) this.cancel({ runId: this.activeRun.run.id });
    this.listeners.clear();
  }

  reconcileInterruptedRuns(): void {
    this.chatStore.reconcileInterruptedRuns();
  }

  private async execute(
    run: ActiveChatRun['run'],
    systemInstruction: string,
    messages: ProviderMessage[],
    providerConfig: {
      providerKind: Parameters<TextGenerationProvider['stream']>[0]['providerKind'];
      baseUrl: string;
      model: string;
      apiKey: string;
      signal: AbortSignal;
    },
  ): Promise<void> {
    let output = '';
    try {
      for await (const delta of this.provider.stream({
        ...providerConfig,
        prompt: '',
        systemInstruction,
        messages,
      })) {
        if (this.activeRun?.run.id !== run.id) return;
        output += delta;
        this.emit({
          type: 'delta',
          runId: run.id,
          threadId: run.threadId,
          entryId: run.entryId,
          messageId: run.assistantMessageId,
          text: delta,
        });
      }
      if (!output.trim()) {
        throw new ChatError(
          CHAT_ERROR_CODES.emptyOutput,
          'Provider 返回了空回答。',
          true,
        );
      }
      const message = this.chatStore.markSucceeded(run, output.trim());
      this.emit({
        type: 'completed',
        runId: run.id,
        threadId: run.threadId,
        entryId: run.entryId,
        messageId: run.assistantMessageId,
        message,
      });
    } catch (error) {
      if (this.activeRun?.run.id !== run.id) return;
      const failure = toChatIpcError(error);
      const interrupted = failure.code === CHAT_ERROR_CODES.interrupted;
      this.chatStore.markFailed(run, failure, interrupted);
      this.emit({
        type: 'failed',
        runId: run.id,
        threadId: run.threadId,
        entryId: run.entryId,
        messageId: run.assistantMessageId,
        error: failure,
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
      || content.isPreview
      || !content.markdown.trim()
    ) {
      throw new ChatError(
        CHAT_ERROR_CODES.contentUnavailable,
        'AI 问答需要已完成清洗的文章正文，请先重新打开文章。',
        true,
      );
    }
    return content;
  }

  private findThread(
    entryId: number,
    content: CleanedContent,
  ): ChatThread | undefined {
    return this.chatStore.findThread(
      entryId,
      contentHash(content),
      CHAT_PROMPT_VERSION,
    );
  }

  private emit(event: ChatStreamEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}

function successfulProviderMessages(
  messages: ReturnType<ChatStore['listMessages']>,
): ProviderMessage[] {
  return messages
    .filter((message) => message.status === 'succeeded')
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function contentHash(content: CleanedContent): string {
  return content.sourceContentHash
    ?? createHash('sha256').update(content.markdown, 'utf8').digest('hex');
}

function validateEntryId(entryId: number): void {
  if (!Number.isInteger(entryId) || entryId <= 0) {
    throw new ChatError(
      CHAT_ERROR_CODES.invalidRequest,
      '文章问答请求无效。',
      false,
    );
  }
}
