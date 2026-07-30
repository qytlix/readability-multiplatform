import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ProviderProfile } from '../../../shared/contracts/provider.types';
import type {
  ChatState,
  ChatStreamEvent,
} from '../../../shared/contracts/chat.types';
import { applyChatStreamEvent } from './articleChatSession';

type ChatLoadStatus = 'idle' | 'loading' | 'success' | 'error';

export interface ArticleChatSession {
  loadStatus: ChatLoadStatus;
  state: ChatState | null;
  provider: ProviderProfile | null;
  errorMessage: string;
  reload: () => Promise<void>;
}

export const useArticleChatSession = (
  entryId: number,
  active: boolean,
): ArticleChatSession => {
  const [loadStatus, setLoadStatus] = useState<ChatLoadStatus>('idle');
  const [state, setState] = useState<ChatState | null>(null);
  const [provider, setProvider] = useState<ProviderProfile | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const requestVersionRef = useRef(0);
  const stateRef = useRef<ChatState | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const reload = useCallback(async () => {
    if (!active) return;
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setLoadStatus('loading');
    setErrorMessage('');

    try {
      const [chatResult, providerResult] = await Promise.all([
        window.shaleAPI.chat.get({ entryId }),
        window.shaleAPI.provider.get(),
      ]);
      if (requestVersionRef.current !== requestVersion) return;
      if (!chatResult.ok) {
        setLoadStatus('error');
        setErrorMessage(chatResult.error.message);
        return;
      }

      stateRef.current = chatResult.data;
      setState(chatResult.data);
      setProvider(providerResult.ok ? providerResult.data : null);
      setLoadStatus('success');
    } catch {
      if (requestVersionRef.current !== requestVersion) return;
      setLoadStatus('error');
      setErrorMessage('无法读取这篇文章的问答记录。');
    }
  }, [active, entryId]);

  useEffect(() => {
    if (!active) {
      requestVersionRef.current += 1;
      stateRef.current = null;
      setState(null);
      setProvider(null);
      setLoadStatus('idle');
      setErrorMessage('');
      return undefined;
    }

    void reload();
    const removeListener = window.shaleAPI.chat.onEvent((
      event: ChatStreamEvent,
    ) => {
      const current = stateRef.current;
      if (!current) return;
      const next = applyChatStreamEvent(current, entryId, event);
      if (next === current) return;
      stateRef.current = next;
      setState(next);
    });

    return () => {
      requestVersionRef.current += 1;
      removeListener();
    };
  }, [active, entryId, reload]);

  return {
    loadStatus,
    state,
    provider,
    errorMessage,
    reload,
  };
};
