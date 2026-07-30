import type { IPCResult } from './feed.ipc';
import type {
  ChatAttachmentPickRequest,
  ChatAttachmentPickResponse,
  ChatAttachmentRemoveRequest,
  ChatAttachmentRemoveResponse,
  ChatClipboardImageImportRequest,
  ChatClipboardImageImportResponse,
  ChatCancelRequest,
  ChatGetRequest,
  ChatRetryRequest,
  ChatRunResponse,
  ChatSendRequest,
  ChatState,
  ChatStreamEvent,
} from './chat.types';

export const CHAT_IPC_CHANNELS = {
  get: 'chat:get',
  send: 'chat:send',
  cancel: 'chat:cancel',
  retry: 'chat:retry',
  attachmentPick: 'chat:attachment-pick',
  attachmentRemove: 'chat:attachment-remove',
  attachmentImportClipboardImage: 'chat:attachment-import-clipboard-image',
  stream: 'chat:stream',
} as const;

export interface ChatAPI {
  get(request: ChatGetRequest): Promise<IPCResult<ChatState>>;
  send(request: ChatSendRequest): Promise<IPCResult<ChatRunResponse>>;
  cancel(request: ChatCancelRequest): Promise<IPCResult<void>>;
  retry(request: ChatRetryRequest): Promise<IPCResult<ChatRunResponse>>;
  pickAttachments(
    request: ChatAttachmentPickRequest,
  ): Promise<IPCResult<ChatAttachmentPickResponse>>;
  removeAttachment(
    request: ChatAttachmentRemoveRequest,
  ): Promise<IPCResult<ChatAttachmentRemoveResponse>>;
  importClipboardImage(
    request: ChatClipboardImageImportRequest,
  ): Promise<IPCResult<ChatClipboardImageImportResponse>>;
  onEvent(listener: (event: ChatStreamEvent) => void): () => void;
}
