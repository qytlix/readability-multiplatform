import {
  useRef,
  type CompositionEvent,
  type KeyboardEvent,
} from 'react';
import type { ChatAttachment } from '../../../shared/contracts/chat.types';
import { getChatComposerKeyAction } from './chatComposerKeyboard';

interface ArticleChatComposerProps {
  value: string;
  running: boolean;
  busy: boolean;
  disabled: boolean;
  errorMessage: string;
  attachments: ChatAttachment[];
  onChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  onPickAttachments: () => void | Promise<void>;
  onRemoveAttachment: (attachmentId: number) => void | Promise<void>;
}

export const ArticleChatComposer = ({
  value,
  running,
  busy,
  disabled,
  errorMessage,
  attachments,
  onChange,
  onSend,
  onStop,
  onPickAttachments,
  onRemoveAttachment,
}: ArticleChatComposerProps) => {
  const composingRef = useRef(false);

  const handleComposition = (
    event: CompositionEvent<HTMLTextAreaElement>,
  ): void => {
    composingRef.current = event.type !== 'compositionend';
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    const action = getChatComposerKeyAction({
      key: event.key,
      shiftKey: event.shiftKey,
      composing: composingRef.current,
      nativeComposing: event.nativeEvent.isComposing,
    });
    if (action !== 'submit' || running || busy || disabled || !value.trim()) return;
    event.preventDefault();
    void onSend();
  };

  return (
    <div className="article-chat-composer">
      {attachments.length > 0 && (
        <div className="article-chat-attachment-chips" aria-label="待发送附件">
          {attachments.map((attachment) => (
            <span key={attachment.id} className="article-chat-attachment-chip">
              <span title={attachment.displayName}>{attachment.displayName}</span>
              <small>{formatAttachmentSize(attachment.byteSize)}</small>
              <button
                type="button"
                aria-label={`移除附件 ${attachment.displayName}`}
                disabled={running || busy}
                onClick={() => void onRemoveAttachment(attachment.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {errorMessage && (
        <p className="article-chat-composer-error" role="alert">
          {errorMessage}
        </p>
      )}
      <div className="article-chat-composer-box">
        <button
          type="button"
          className="article-chat-attachment-button"
          aria-label="添加附件"
          disabled={
            running
            || busy
            || disabled
            || attachments.length >= 5
          }
          onClick={() => void onPickAttachments()}
        >
          +
        </button>
        <textarea
          value={value}
          rows={1}
          maxLength={20_000}
          aria-label="向文章提问"
          placeholder="围绕这篇文章提问…"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleComposition}
          onCompositionUpdate={handleComposition}
          onCompositionEnd={handleComposition}
        />
        <button
          type="button"
          className={running ? 'is-stop' : 'is-send'}
          aria-label={running ? '停止生成' : '发送问题'}
          disabled={running ? busy : disabled || busy || !value.trim()}
          onClick={() => void (running ? onStop() : onSend())}
        >
          {running ? '停止' : '发送'}
        </button>
      </div>
      <div className="article-chat-composer-hint">
        Enter 发送 · Shift+Enter 换行
      </div>
    </div>
  );
};

const formatAttachmentSize = (byteSize: number): string => (
  byteSize < 1_024
    ? `${byteSize} B`
    : byteSize < 1_048_576
      ? `${Math.ceil(byteSize / 1_024)} KB`
      : `${(byteSize / 1_048_576).toFixed(1)} MB`
);
