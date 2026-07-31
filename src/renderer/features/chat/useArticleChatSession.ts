import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  isValidProviderModel,
  type ProviderChatModel,
  type ProviderProfile,
} from '../../../shared/contracts/provider.types';
import type {
  ChatSelectionContext,
  ChatState,
  ChatStreamEvent,
} from '../../../shared/contracts/chat.types';
import { applyChatStreamEvent } from './articleChatSession';
import {
  buildProviderRequestWithChatModel,
  type ChatModelCatalogStatus,
} from './chatModelSelection';
import type { ChatClipboardImageInput } from './chatClipboard';

type ChatLoadStatus = 'idle' | 'loading' | 'success' | 'error';
type ChatActionStatus =
  | 'idle'
  | 'sending'
  | 'stopping'
  | 'retrying'
  | 'switching-model'
  | 'importing'
  | 'removing';

export interface ArticleChatSession {
  loadStatus: ChatLoadStatus;
  state: ChatState | null;
  provider: ProviderProfile | null;
  availableChatModels: ProviderChatModel[];
  chatModelCatalogStatus: ChatModelCatalogStatus;
  chatModelCatalogErrorMessage: string;
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
  loadChatModels: () => Promise<boolean>;
  switchChatModel: (model: string) => Promise<boolean>;
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
  const [availableChatModels, setAvailableChatModels] = useState<
    ProviderChatModel[]
  >([]);
  const [chatModelCatalogStatus, setChatModelCatalogStatus] =
    useState<ChatModelCatalogStatus>('idle');
  const [
    chatModelCatalogErrorMessage,
    setChatModelCatalogErrorMessage,
  ] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [actionStatus, setActionStatus] = useState<ChatActionStatus>('idle');
  const [actionErrorMessage, setActionErrorMessage] = useState('');
  const requestVersionRef = useRef(0);
  const modelCatalogRequestVersionRef = useRef(0);
  const modelCatalogScopeRef = useRef('');
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
      const nextProvider = providerResult.ok ? providerResult.data : null;
      const nextCatalogScope = nextProvider
        ? [
          nextProvider.chatProviderKind,
          nextProvider.chatBaseUrl,
          nextProvider.hasChatApiKey,
        ].join('\u0000')
        : '';
      if (modelCatalogScopeRef.current !== nextCatalogScope) {
        modelCatalogScopeRef.current = nextCatalogScope;
        modelCatalogRequestVersionRef.current += 1;
        setAvailableChatModels([]);
        setChatModelCatalogStatus('idle');
        setChatModelCatalogErrorMessage('');
      }
      setProvider(nextProvider);
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
      modelCatalogRequestVersionRef.current += 1;
      modelCatalogScopeRef.current = '';
      setAvailableChatModels([]);
      setChatModelCatalogStatus('idle');
      setChatModelCatalogErrorMessage('');
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
      modelCatalogRequestVersionRef.current += 1;
      removeListener();
    };
  }, [active, entryId, reload]);

  const loadChatModels = useCallback(async (): Promise<boolean> => {
    const currentProvider = provider;
    if (!active || !currentProvider?.hasChatApiKey) return false;

    const requestVersion = modelCatalogRequestVersionRef.current + 1;
    modelCatalogRequestVersionRef.current = requestVersion;
    setChatModelCatalogStatus('loading');
    setChatModelCatalogErrorMessage('');
    try {
      const result = await window.shaleAPI.provider.listChatModels();
      if (modelCatalogRequestVersionRef.current !== requestVersion) return false;
      if (!result.ok) {
        setChatModelCatalogStatus('error');
        setChatModelCatalogErrorMessage(result.error.message);
        return false;
      }
      if (result.data.providerKind !== currentProvider.chatProviderKind) {
        setChatModelCatalogStatus('error');
        setChatModelCatalogErrorMessage('问答 Provider 已变化，请重新打开模型列表。');
        return false;
      }
      setAvailableChatModels(result.data.models);
      setChatModelCatalogStatus('success');
      return true;
    } catch {
      if (modelCatalogRequestVersionRef.current !== requestVersion) return false;
      setChatModelCatalogStatus('error');
      setChatModelCatalogErrorMessage('无法读取此 API Key 可用的模型，请稍后重试。');
      return false;
    }
  }, [active, provider]);

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
        // Context preparation can fail after the Main process reserves and
        // persists the run. Reload so the visible failure/retry state matches
        // the durable conversation immediately.
        await reload();
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

  const switchChatModel = useCallback(async (
    model: string,
  ): Promise<boolean> => {
    const nextModel = model.trim();
    const currentProvider = provider;
    if (
      !active
      || stateRef.current?.state === 'running'
      || !currentProvider
    ) {
      return false;
    }
    if (nextModel === currentProvider.chatModel) return true;
    if (!isValidProviderModel(nextModel)) {
      setActionErrorMessage('所选问答模型名称无效。');
      return false;
    }

    setActionStatus('switching-model');
    setActionErrorMessage('');
    try {
      const result = await window.shaleAPI.provider.save(
        buildProviderRequestWithChatModel(currentProvider, nextModel),
      );
      if (!result.ok) {
        setActionErrorMessage(result.error.message);
        return false;
      }
      setProvider(result.data);
      return true;
    } catch {
      setActionErrorMessage('无法切换问答模型，请稍后重试。');
      return false;
    } finally {
      setActionStatus('idle');
    }
  }, [active, provider]);

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
    availableChatModels,
    chatModelCatalogStatus,
    chatModelCatalogErrorMessage,
    errorMessage,
    actionStatus,
    actionErrorMessage,
    reload,
    sendQuestion,
    stop,
    retry,
    loadChatModels,
    switchChatModel,
    pickAttachments,
    removeAttachment,
    importClipboardImages,
  };
};
