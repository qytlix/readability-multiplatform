import {
  useRef,
  type CompositionEvent,
  type KeyboardEvent,
} from 'react';
import { getChatComposerKeyAction } from './chatComposerKeyboard';

interface ArticleChatComposerProps {
  value: string;
  running: boolean;
  busy: boolean;
  disabled: boolean;
  errorMessage: string;
  onChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
}

export const ArticleChatComposer = ({
  value,
  running,
  busy,
  disabled,
  errorMessage,
  onChange,
  onSend,
  onStop,
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
      {errorMessage && (
        <p className="article-chat-composer-error" role="alert">
          {errorMessage}
        </p>
      )}
      <div className="article-chat-composer-box">
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
