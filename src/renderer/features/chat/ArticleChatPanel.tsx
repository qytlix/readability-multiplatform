import {
  CloseIcon,
  CopyIcon,
  EditIcon,
  SyncIcon,
} from '../reader/ReaderIcons';
import { useEffect, useRef, useState } from 'react';
import { useArticleChatSession } from './useArticleChatSession';
import { ArticleChatComposer } from './ArticleChatComposer';
import { ChatMarkdown } from './ChatMarkdown';
import type { ArticleChatSelectionRequest } from './articleChatSelection';
import type { ShaleError } from '../../../shared/contracts/feed.ipc';
import { CHAT_ERROR_CODES } from '../../../shared/errors/chat.errors';
import type { ChatMessage } from '../../../shared/contracts/chat.types';

interface ArticleChatPanelProps {
  entryId: number;
  entryTitle: string;
  onClose: () => void;
  selectionRequest?: ArticleChatSelectionRequest;
  onSelectionCleared: (requestId: number) => void;
}

export const ArticleChatPanel = ({
  entryId,
  entryTitle,
  onClose,
  selectionRequest,
  onSelectionCleared,
}: ArticleChatPanelProps) => {
  const session = useArticleChatSession(entryId, true);
  const [draft, setDraft] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [copyFeedback, setCopyFeedback] = useState<{
    messageId: number;
    status: 'copied' | 'failed';
  } | null>(null);
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [pendingSelection, setPendingSelection] =
    useState<ArticleChatSelectionRequest | null>(selectionRequest ?? null);
  const preparing = session.actionStatus === 'sending'
    || session.actionStatus === 'retrying'
    || session.actionStatus === 'regenerating';
  const running = session.state?.state === 'running' || preparing;
  const busy = session.actionStatus !== 'idle' && !preparing;

  useEffect(() => {
    if (selectionRequest?.selection.entryId !== entryId) return;
    setPendingSelection(selectionRequest);
  }, [entryId, selectionRequest]);

  useEffect(() => () => {
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
    }
  }, []);

  useEffect(() => {
    setEditingMessageId(null);
    setEditDraft('');
    setCopyFeedback(null);
  }, [entryId]);

  const handleSend = async (): Promise<void> => {
    const sent = await session.sendQuestion(
      draft,
      session.state?.draftAttachments.map(({ id }) => id) ?? [],
      pendingSelection?.selection,
    );
    if (sent) {
      setDraft('');
      if (pendingSelection) {
        onSelectionCleared(pendingSelection.requestId);
        setPendingSelection(null);
      }
    }
  };

  const removePendingSelection = (): void => {
    if (!pendingSelection) return;
    onSelectionCleared(pendingSelection.requestId);
    setPendingSelection(null);
  };

  const copyMessage = async (message: ChatMessage): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message.content);
      showCopyFeedback(message.id, 'copied');
    } catch {
      showCopyFeedback(message.id, 'failed');
    }
  };

  const showCopyFeedback = (
    messageId: number,
    status: 'copied' | 'failed',
  ): void => {
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
    }
    setCopyFeedback({ messageId, status });
    copyFeedbackTimerRef.current = setTimeout(() => {
      setCopyFeedback(null);
      copyFeedbackTimerRef.current = null;
    }, 1_800);
  };

  const beginEditing = (message: ChatMessage): void => {
    setEditingMessageId(message.id);
    setEditDraft(message.content);
  };

  const cancelEditing = (): void => {
    setEditingMessageId(null);
    setEditDraft('');
  };

  const submitEdit = async (messageId: number): Promise<void> => {
    if (!editDraft.trim()) return;
    const regenerated = await session.regenerate(messageId, editDraft);
    if (regenerated) cancelEditing();
  };

  return (
    <section className="article-chat-panel" aria-label="文章 AI 问答">
      <header className="article-chat-header">
        <div>
          <span className="article-chat-eyebrow">ARTICLE GUIDE</span>
          <h2>问问这篇文章</h2>
          <p title={entryTitle}>{entryTitle}</p>
        </div>
        <button
          type="button"
          className="icon-button article-chat-close"
          aria-label="关闭 AI 问答"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>

      <div className="article-chat-messages" aria-live="polite">
        {session.loadStatus === 'loading' && (
          <div className="article-chat-placeholder" role="status">
            正在读取问答记录…
          </div>
        )}
        {session.loadStatus === 'error' && (
          <div className="article-chat-load-error" role="alert">
            <p>{session.errorMessage}</p>
            <button type="button" onClick={() => void session.reload()}>
              重试
            </button>
          </div>
        )}
        {session.loadStatus === 'success'
          && session.state
          && session.state.messages.length === 0 && (
          <div className="article-chat-empty">
            <p>从文章本身开始，而不是从空白对话开始。</p>
            <div className="article-chat-suggestions" aria-label="建议问题">
              {[
                '概括作者的核心论点',
                '这篇文章最重要的证据是什么？',
                '有哪些限制或反例？',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setDraft(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {session.state?.messages.map((message, index, messages) => {
          const sourceUserMessage = message.role === 'assistant'
            ? findSourceUserMessage(messages, index)
            : undefined;
          const editing = editingMessageId === message.id;
          const messageCopyFeedback = copyFeedback?.messageId === message.id
            ? copyFeedback.status
            : null;
          return (
            <article
              key={message.id}
              className={`article-chat-message is-${message.role} is-${message.status}${
                editing ? ' is-editing' : ''
              }`}
              data-message-id={message.id}
            >
              {message.selection && (
                <blockquote>{message.selection.text}</blockquote>
              )}
              {editing ? (
                <div className="article-chat-message-editor">
                  <textarea
                    autoFocus
                    rows={3}
                    maxLength={20_000}
                    aria-label="编辑问题"
                    value={editDraft}
                    disabled={busy || running}
                    onChange={(event) => setEditDraft(event.target.value)}
                  />
                  <div className="article-chat-message-editor-actions">
                    <button
                      type="button"
                      disabled={busy || running}
                      onClick={cancelEditing}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="is-primary"
                      disabled={busy || running || !editDraft.trim()}
                      onClick={() => void submitEdit(message.id)}
                    >
                      发送
                    </button>
                  </div>
                </div>
              ) : (
                <div className="article-chat-message-content">
                  {message.content && message.role === 'assistant' && (
                    <ChatMarkdown content={message.content} />
                  )}
                  {message.content && message.role === 'user' && message.content}
                  {!message.content && (
                    <span className="article-chat-streaming">正在组织回答…</span>
                  )}
                </div>
              )}
              {message.attachments.length > 0 && (
                <div className="article-chat-message-attachments">
                  {message.attachments.map((attachment) => (
                    <span key={attachment.id}>{attachment.displayName}</span>
                  ))}
                </div>
              )}
              {message.status === 'interrupted' && <small>回答已停止</small>}
              {!editing && (
                <div
                  className="article-chat-message-actions"
                  aria-label={message.role === 'user' ? '问题操作' : '回答操作'}
                >
                  {message.content && (
                    <button
                      type="button"
                      className={messageCopyFeedback === 'copied' ? 'is-success' : ''}
                      aria-label={messageCopyFeedback === 'copied'
                        ? '消息已复制'
                        : messageCopyFeedback === 'failed'
                          ? '消息复制失败'
                          : '复制消息'}
                      onClick={() => void copyMessage(message)}
                    >
                      <CopyIcon />
                      {messageCopyFeedback === 'copied'
                        ? '已复制'
                        : messageCopyFeedback === 'failed'
                          ? '复制失败'
                          : '复制'}
                    </button>
                  )}
                  {message.role === 'user' && (
                    <button
                      type="button"
                      disabled={busy || running}
                      aria-label="编辑问题"
                      onClick={() => beginEditing(message)}
                    >
                      <EditIcon />
                      编辑
                    </button>
                  )}
                  {message.role === 'assistant'
                    && sourceUserMessage
                    && message.status !== 'running' && (
                    <button
                      type="button"
                      disabled={busy || running}
                      aria-label="重新回答"
                      onClick={() => void session.regenerate(sourceUserMessage.id)}
                    >
                      <SyncIcon />
                      重新回答
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
        {session.state?.state === 'failed' && (
          <div className="article-chat-retry">
            <p role="alert">
              {formatChatFailureMessage(session.state.run.error)}
            </p>
          </div>
        )}
      </div>
      <ArticleChatComposer
        entryId={entryId}
        value={draft}
        running={running}
        busy={busy}
        disabled={session.loadStatus !== 'success'}
        errorMessage={session.actionErrorMessage}
        provider={session.provider}
        availableModels={session.availableChatModels}
        modelCatalogStatus={session.chatModelCatalogStatus}
        modelCatalogErrorMessage={session.chatModelCatalogErrorMessage}
        attachments={session.state?.draftAttachments ?? []}
        selection={pendingSelection?.selection}
        selectionFocusRequestId={pendingSelection?.requestId}
        onChange={setDraft}
        onSend={handleSend}
        onStop={() => void session.stop()}
        onRequestModels={session.loadChatModels}
        onSelectModel={session.switchChatModel}
        onRemoveSelection={removePendingSelection}
        onPickAttachments={() => void session.pickAttachments()}
        onRemoveAttachment={(attachmentId) => {
          void session.removeAttachment(attachmentId);
        }}
        onPasteImages={(images) => {
          void session.importClipboardImages(images);
        }}
      />
    </section>
  );
};

const findSourceUserMessage = (
  messages: ChatMessage[],
  assistantIndex: number,
): ChatMessage | undefined => {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return messages[index];
  }
  return undefined;
};

const formatChatFailureMessage = (error?: ShaleError): string => {
  if (!error) return '回答未完成，请重试。';
  switch (error.code) {
    case CHAT_ERROR_CODES.CHAT_PROVIDER_REQUEST_FAILED: {
      const status = error.message.match(/\bstatus (\d{3})\b/i)?.[1];
      return `模型服务暂时不可用${status ? `（HTTP ${status}）` : ''}。`
        + '应用已自动重试；请稍后再试，若持续失败请切换模型。';
    }
    case CHAT_ERROR_CODES.CHAT_PROVIDER_TIMEOUT:
      return '模型服务响应超时。请稍后再试，若持续失败请切换模型。';
    case CHAT_ERROR_CODES.CHAT_NETWORK_ERROR:
      return '无法连接模型服务。请检查网络后重试。';
    case CHAT_ERROR_CODES.CHAT_PROVIDER_AUTH:
      return '模型服务拒绝了当前 API Key，请检查问答模型配置。';
    default:
      return '回答未完成，请重试；若持续失败请检查问答模型配置。';
  }
};
