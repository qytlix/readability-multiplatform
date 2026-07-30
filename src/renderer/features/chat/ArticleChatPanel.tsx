import { CloseIcon } from '../reader/ReaderIcons';
import type {
  ChatContextMode,
  ChatMessage,
} from '../../../shared/contracts/chat.types';
import { useArticleChatSession } from './useArticleChatSession';

interface ArticleChatPanelProps {
  entryId: number;
  entryTitle: string;
  onClose: () => void;
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
}: ArticleChatPanelProps) => {
  const session = useArticleChatSession(entryId, true);
  const contextMode = session.state?.state === 'running'
    ? session.state.run.contextMode
    : getCurrentContextMode(session.state?.messages ?? []);

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
              <span>概括作者的核心论点</span>
              <span>这篇文章最重要的证据是什么？</span>
              <span>有哪些限制或反例？</span>
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
              {message.content || (
                <span className="article-chat-streaming">正在组织回答…</span>
              )}
            </div>
            {message.status === 'failed' && <small>回答失败</small>}
            {message.status === 'interrupted' && <small>回答已停止</small>}
          </article>
        ))}
      </div>
    </section>
  );
};
