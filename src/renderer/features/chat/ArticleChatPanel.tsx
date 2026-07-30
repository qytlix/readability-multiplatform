import { CloseIcon } from '../reader/ReaderIcons';

interface ArticleChatPanelProps {
  entryTitle: string;
  onClose: () => void;
}

export const ArticleChatPanel = ({
  entryTitle,
  onClose,
}: ArticleChatPanelProps) => (
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
    <div className="article-chat-placeholder" role="status">
      正在准备文章对话…
    </div>
  </section>
);
