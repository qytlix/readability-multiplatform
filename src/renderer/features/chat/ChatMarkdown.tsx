import { memo, type MouseEvent } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatMarkdownProps {
  content: string;
}

const isPlainPrimaryClick = (event: MouseEvent<HTMLAnchorElement>): boolean =>
  event.button === 0
  && !event.metaKey
  && !event.ctrlKey
  && !event.shiftKey
  && !event.altKey;

const markdownComponents: Components = {
  a: ({ children, href }) => {
    if (!href) return <span>{children}</span>;

    const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
      event.preventDefault();
      if (!isPlainPrimaryClick(event)) return;

      void window.shaleAPI.external.open({ url: href }).catch(() => undefined);
    };

    return (
      <a href={href} onClick={handleClick}>
        {children}
      </a>
    );
  },
  img: ({ alt }) => (
    <span className="article-chat-remote-image">
      {alt ? `[图片：${alt}]` : '[图片]'}
    </span>
  ),
};

export const ChatMarkdown = memo(({ content }: ChatMarkdownProps) => (
  <div className="article-chat-markdown">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={markdownComponents}
    >
      {content}
    </ReactMarkdown>
  </div>
));

ChatMarkdown.displayName = 'ChatMarkdown';
