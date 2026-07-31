import { CloseIcon } from '../reader/ReaderIcons';
import { useEffect, useState } from 'react';
import type {
  ChatContextMode,
  ChatMessage,
} from '../../../shared/contracts/chat.types';
import { useArticleChatSession } from './useArticleChatSession';
import { ArticleChatComposer } from './ArticleChatComposer';
import { ChatMarkdown } from './ChatMarkdown';
import type { ArticleChatSelectionRequest } from './articleChatSelection';

interface ArticleChatPanelProps {
  entryId: number;
  entryTitle: string;
  onClose: () => void;
  onActiveRunChange: (
    activeRun: { entryId: number; runId: number } | null,
  ) => void;
  selectionRequest?: ArticleChatSelectionRequest;
  onSelectionCleared: (requestId: number) => void;
}

const CONTEXT_MODE_LABELS: Record<ChatContextMode, string> = {
  full: '使用完整文章上下文',
  'history-compressed': '已压缩早期对话，文章全文保持完整',
  'article-map': '文章过长，使用全文分析与相关原文',
};

const getCurrentContextMode = (
  messages: ChatMessage[],
): ChatContextMode | null => (
  [...messages]
    .reverse()
    .find(({ role }) => role === 'assistant')
    ?.articleContextMode ?? null
);

export const ArticleChatPanel = ({
  entryId,
  entryTitle,
  onClose,
  onActiveRunChange,
  selectionRequest,
  onSelectionCleared,
}: ArticleChatPanelProps) => {
  const session = useArticleChatSession(entryId, true);
  const [draft, setDraft] = useState('');
  const [pendingSelection, setPendingSelection] =
    useState<ArticleChatSelectionRequest | null>(selectionRequest ?? null);
  const contextMode = session.state?.state === 'running'
    ? session.state.run.contextMode
    : getCurrentContextMode(session.state?.messages ?? []);
  const running = session.state?.state === 'running';
  const activeRunId = session.state?.state === 'running'
    ? session.state.run.id
    : null;
  const busy = session.actionStatus !== 'idle';

  useEffect(() => {
    onActiveRunChange(activeRunId !== null
      ? { entryId, runId: activeRunId }
      : null);
  }, [activeRunId, entryId, onActiveRunChange]);

  useEffect(() => {
    if (selectionRequest?.selection.entryId !== entryId) return;
    setPendingSelection(selectionRequest);
  }, [entryId, selectionRequest]);

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

      <div className="article-chat-meta" aria-label="问答上下文信息">
        <span>
          {session.provider
            ? `${session.provider.chatProviderKind} · ${session.provider.chatModel}`
            : '尚未配置问答模型'}
        </span>
        {contextMode && <span>{CONTEXT_MODE_LABELS[contextMode]}</span>}
      </div>

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
        {session.state?.messages.map((message) => (
          <article
            key={message.id}
            className={`article-chat-message is-${message.role} is-${message.status}`}
            data-message-id={message.id}
          >
            <div className="article-chat-message-role">
              {message.role === 'user' ? '你' : 'Shale'}
            </div>
            {message.selection && (
              <blockquote>{message.selection.text}</blockquote>
            )}
            <div className="article-chat-message-content">
              {message.content && message.role === 'assistant' && (
                <ChatMarkdown content={message.content} />
              )}
              {message.content && message.role === 'user' && message.content}
              {!message.content && (
                <span className="article-chat-streaming">正在组织回答…</span>
              )}
            </div>
            {message.attachments.length > 0 && (
              <div className="article-chat-message-attachments">
                {message.attachments.map((attachment) => (
                  <span key={attachment.id}>{attachment.displayName}</span>
                ))}
              </div>
            )}
            {message.status === 'failed' && <small>回答失败</small>}
            {message.status === 'interrupted' && <small>回答已停止</small>}
          </article>
        ))}
        {(session.state?.state === 'failed'
          || session.state?.state === 'interrupted') && (
          <div className="article-chat-retry">
            <button
              type="button"
              disabled={busy}
              onClick={() => void session.retry()}
            >
              重新回答
            </button>
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
        attachments={session.state?.draftAttachments ?? []}
        selection={pendingSelection?.selection}
        selectionFocusRequestId={pendingSelection?.requestId}
        onChange={setDraft}
        onSend={handleSend}
        onStop={() => void session.stop()}
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
