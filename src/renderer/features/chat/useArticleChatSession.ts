import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ProviderProfile } from '../../../shared/contracts/provider.types';
import type {
  ChatSelectionContext,
  ChatState,
  ChatStreamEvent,
} from '../../../shared/contracts/chat.types';
import { applyChatStreamEvent } from './articleChatSession';
import type { ChatClipboardImageInput } from './chatClipboard';

type ChatLoadStatus = 'idle' | 'loading' | 'success' | 'error';
type ChatActionStatus =
  | 'idle'
  | 'sending'
  | 'stopping'
  | 'retrying'
  | 'importing'
  | 'removing';

export interface ArticleChatSession {
  loadStatus: ChatLoadStatus;
  state: ChatState | null;
  provider: ProviderProfile | null;
  errorMessage: string;
  actionStatus: ChatActionStatus;
  actionErrorMessage: string;
  reload: () => Promise<void>;
  sendQuestion: (
    question: string,
    attachmentIds?: number[],
    selection?: ChatSelectionContext,
  ) => Promise<boolean>;
  stop: () => Promise<boolean>;
  retry: () => Promise<boolean>;
  pickAttachments: () => Promise<boolean>;
  removeAttachment: (attachmentId: number) => Promise<boolean>;
  importClipboardImages: (
    images: ChatClipboardImageInput[],
  ) => Promise<boolean>;
}

export const useArticleChatSession = (
  entryId: number,
  active: boolean,
): ArticleChatSession => {
  const [loadStatus, setLoadStatus] = useState<ChatLoadStatus>('idle');
  const [state, setState] = useState<ChatState | null>(null);
  const [provider, setProvider] = useState<ProviderProfile | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [actionStatus, setActionStatus] = useState<ChatActionStatus>('idle');
  const [actionErrorMessage, setActionErrorMessage] = useState('');
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
      setActionStatus('idle');
      setActionErrorMessage('');
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

  const sendQuestion = useCallback(async (
    question: string,
    attachmentIds: number[] = [],
    selection?: ChatSelectionContext,
  ): Promise<boolean> => {
    if (!active || stateRef.current?.state === 'running' || !question.trim()) {
      return false;
    }
    setActionStatus('sending');
    setActionErrorMessage('');
    try {
      const result = await window.shaleAPI.chat.send({
        entryId,
        question,
        selection,
        attachmentIds,
      });
      if (!result.ok) {
        setActionErrorMessage(result.error.message);
        return false;
      }
      await reload();
      return true;
    } catch {
      setActionErrorMessage('问题发送失败，请检查问答模型配置后重试。');
      return false;
    } finally {
      setActionStatus('idle');
    }
  }, [active, entryId, reload]);

  const stop = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current;
    if (!active || current?.state !== 'running') return false;
    setActionStatus('stopping');
    setActionErrorMessage('');
    try {
      const result = await window.shaleAPI.chat.cancel({
        runId: current.run.id,
      });
      if (!result.ok) {
        setActionErrorMessage(result.error.message);
        return false;
      }
      await reload();
      return true;
    } catch {
      setActionErrorMessage('无法停止当前回答，请稍后重试。');
      return false;
    } finally {
      setActionStatus('idle');
    }
  }, [active, reload]);

  const retry = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current;
    if (
      !active
      || (current?.state !== 'failed' && current?.state !== 'interrupted')
    ) {
      return false;
    }
    setActionStatus('retrying');
    setActionErrorMessage('');
    try {
      const result = await window.shaleAPI.chat.retry({
        runId: current.run.id,
      });
      if (!result.ok) {
        setActionErrorMessage(result.error.message);
        return false;
      }
      await reload();
      return true;
    } catch {
      setActionErrorMessage('无法重试这次回答，请稍后再试。');
      return false;
    } finally {
      setActionStatus('idle');
    }
  }, [active, reload]);

  const pickAttachments = useCallback(async (): Promise<boolean> => {
    if (!active || stateRef.current?.state === 'running') return false;
    setActionStatus('importing');
    setActionErrorMessage('');
    try {
      const result = await window.shaleAPI.chat.pickAttachments({ entryId });
      if (!result.ok) {
        setActionErrorMessage(result.error.message);
        return false;
      }
      if (result.data.failures.length > 0) {
        setActionErrorMessage(result.data.failures
          .map(({ displayName, error }) => `${displayName}：${error.message}`)
          .join('\n'));
      }
      if (!result.data.canceled) await reload();
      return result.data.attachments.length > 0;
    } catch {
      setActionErrorMessage('无法导入所选附件。');
      return false;
    } finally {
      setActionStatus('idle');
    }
  }, [active, entryId, reload]);

  const removeAttachment = useCallback(async (
    attachmentId: number,
  ): Promise<boolean> => {
    if (!active || stateRef.current?.state === 'running') return false;
    setActionStatus('removing');
    setActionErrorMessage('');
    try {
      const result = await window.shaleAPI.chat.removeAttachment({
        entryId,
        attachmentId,
      });
      if (!result.ok) {
        setActionErrorMessage(result.error.message);
        return false;
      }
      if (result.data.removed) await reload();
      return result.data.removed;
    } catch {
      setActionErrorMessage('无法移除这个附件。');
      return false;
    } finally {
      setActionStatus('idle');
    }
  }, [active, entryId, reload]);

  const importClipboardImages = useCallback(async (
    images: ChatClipboardImageInput[],
  ): Promise<boolean> => {
    if (
      !active
      || stateRef.current?.state === 'running'
      || images.length === 0
    ) {
      return false;
    }
    setActionStatus('importing');
    setActionErrorMessage('');
    let imported = 0;
    const failures: string[] = [];
    try {
      for (const image of images) {
        const result = await window.shaleAPI.chat.importClipboardImage({
          entryId,
          ...image,
        });
        if (result.ok) {
          imported += 1;
        } else {
          failures.push(
            `${image.suggestedDisplayName}：${result.error.message}`,
          );
        }
      }
      if (failures.length > 0) setActionErrorMessage(failures.join('\n'));
      if (imported > 0) await reload();
      return imported > 0;
    } catch {
      setActionErrorMessage('无法导入剪贴板图片。');
      return false;
    } finally {
      setActionStatus('idle');
    }
  }, [active, entryId, reload]);

  return {
    loadStatus,
    state,
    provider,
    errorMessage,
    actionStatus,
    actionErrorMessage,
    reload,
    sendQuestion,
    stop,
    retry,
    pickAttachments,
    removeAttachment,
    importClipboardImages,
  };
};
