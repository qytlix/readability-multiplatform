import type { IPCResult } from './feed.ipc';
import type {
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
  stream: 'chat:stream',
} as const;

export interface ChatAPI {
  get(request: ChatGetRequest): Promise<IPCResult<ChatState>>;
  send(request: ChatSendRequest): Promise<IPCResult<ChatRunResponse>>;
  cancel(request: ChatCancelRequest): Promise<IPCResult<void>>;
  retry(request: ChatRetryRequest): Promise<IPCResult<ChatRunResponse>>;
  onEvent(listener: (event: ChatStreamEvent) => void): () => void;
}
