import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import type {
  ChatMessage,
  ChatState,
  ChatStreamEvent,
} from '../../../shared/contracts/chat.types';

interface ChatPanelProps {
  entryId: number;
  isContentReady: boolean;
  isVisible: boolean;
  onVisibleChange: (isVisible: boolean) => void;
}

export const ChatPanel = ({
  entryId,
  isContentReady,
  isVisible,
  onVisibleChange,
}: ChatPanelProps) => {
  const [state, setState] = useState<ChatState>({ entryId, messages: [] });
  const [question, setQuestion] = useState('');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const activeRunIdRef = useRef<number | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);

  const loadState = useCallback(async (): Promise<void> => {
    if (!isContentReady) {
      setState({ entryId, messages: [] });
      activeRunIdRef.current = null;
      setIsSending(false);
      return;
    }
    try {
      const result = await window.shaleAPI.chat.get({ entryId });
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      setState(result.data);
      activeRunIdRef.current = result.data.activeRun?.id ?? null;
      setIsSending(Boolean(result.data.activeRun));
    } catch {
      setMessage('无法加载文章问答记录。');
    }
  }, [entryId, isContentReady]);

  useEffect(() => {
    setState({ entryId, messages: [] });
    setQuestion('');
    setMessage('');
    activeRunIdRef.current = null;
    setIsSending(false);
    void loadState();
  }, [entryId, loadState]);

  useEffect(() => {
    const unsubscribe = window.shaleAPI.chat.onEvent((event: ChatStreamEvent) => {
      if (event.entryId !== entryId) return;
      if (
        activeRunIdRef.current !== null
        && event.runId !== activeRunIdRef.current
      ) {
        return;
      }

      if (event.type === 'started') {
        activeRunIdRef.current = event.runId;
        setIsSending(true);
        return;
      }
      if (event.type === 'delta') {
        setState((current) => ({
          ...current,
          messages: appendDelta(current.messages, event.messageId, event.text),
        }));
        return;
      }
      if (event.type === 'completed') {
        setState((current) => ({
          ...current,
          messages: replaceMessage(current.messages, event.message),
          activeRun: undefined,
        }));
        activeRunIdRef.current = null;
        setIsSending(false);
        return;
      }
      setMessage(event.error.message);
      activeRunIdRef.current = null;
      setIsSending(false);
      void loadState();
    });
    return unsubscribe;
  }, [entryId, loadState]);

  useEffect(() => {
    if (!isVisible) return;
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [isVisible, state.messages]);

  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const nextQuestion = question.trim();
    if (!nextQuestion || isSending || !isContentReady) return;
    setMessage('');
    setIsSending(true);
    try {
      const result = await window.shaleAPI.chat.send({
        entryId,
        question: nextQuestion,
      });
      if (!result.ok) {
        setMessage(result.error.message);
        setIsSending(false);
        return;
      }
      activeRunIdRef.current = result.data.runId;
      setQuestion('');
      await loadState();
    } catch {
      setMessage('无法开始文章问答。');
      setIsSending(false);
    }
  };

  const cancel = async (): Promise<void> => {
    const runId = activeRunIdRef.current;
    if (!runId) return;
    const result = await window.shaleAPI.chat.cancel({ runId });
    if (!result.ok) setMessage(result.error.message);
  };

  const clear = async (): Promise<void> => {
    if (isSending) return;
    const result = await window.shaleAPI.chat.clear({ entryId });
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    setState({ entryId, messages: [] });
    setMessage('');
  };

  if (!isVisible) return null;

  return (
    <section
      id="article-chat-panel"
      className="article-chat-panel"
      aria-label="文章 AI 问答"
    >
      <header className="article-chat-header">
        <div>
          <h2>ASK THIS ARTICLE</h2>
          <p>回答只基于当前文章和本段对话。</p>
        </div>
        <div className="article-chat-header-actions">
          <button
            type="button"
            onClick={() => void clear()}
            disabled={isSending || state.messages.length === 0}
          >
            清空
          </button>
          <button type="button" onClick={() => onVisibleChange(false)}>
            关闭
          </button>
        </div>
      </header>

      <div className="article-chat-messages" ref={messageListRef} aria-live="polite">
        {state.messages.length === 0 && (
          <p className="article-chat-empty">
            可以询问要点、论据、术语，或让 AI 从文中查找依据。
          </p>
        )}
        {state.messages.map((chatMessage) => (
          <article
            key={chatMessage.id}
            className={`article-chat-message is-${chatMessage.role}`}
          >
            <span>{chatMessage.role === 'user' ? '你' : 'AI'}</span>
            <p>{chatMessage.content || (chatMessage.status === 'streaming' ? '…' : '')}</p>
            {(chatMessage.status === 'failed' || chatMessage.status === 'interrupted') && (
              <small>{chatMessage.status === 'interrupted' ? '回答已停止' : '回答失败'}</small>
            )}
          </article>
        ))}
      </div>

      {message && <p className="entry-detail-ai-error" role="status">{message}</p>}
      <form className="article-chat-compose" onSubmit={(event) => void send(event)}>
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={isContentReady ? '针对这篇文章提问…' : '文章清洗完成后可提问'}
          rows={2}
          maxLength={8_000}
          disabled={!isContentReady || isSending}
          aria-label="文章问题"
        />
        {isSending ? (
          <button type="button" onClick={() => void cancel()}>停止</button>
        ) : (
          <button type="submit" disabled={!isContentReady || !question.trim()}>
            发送
          </button>
        )}
      </form>
    </section>
  );
};

function appendDelta(
  messages: ChatMessage[],
  messageId: number,
  text: string,
): ChatMessage[] {
  return messages.map((message) => (
    message.id === messageId
      ? { ...message, content: message.content + text, status: 'streaming' }
      : message
  ));
}

function replaceMessage(
  messages: ChatMessage[],
  nextMessage: ChatMessage,
): ChatMessage[] {
  const exists = messages.some((message) => message.id === nextMessage.id);
  return exists
    ? messages.map((message) => (
      message.id === nextMessage.id ? nextMessage : message
    ))
    : [...messages, nextMessage];
}
