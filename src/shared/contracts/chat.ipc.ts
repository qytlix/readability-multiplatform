import type { IPCResult } from './feed.ipc';
import type {
  ChatCancelRequest,
  ChatClearRequest,
  ChatGetRequest,
  ChatSendRequest,
  ChatSendResponse,
  ChatState,
  ChatStreamEvent,
} from './chat.types';

export const CHAT_IPC_CHANNELS = {
  get: 'chat:get',
  send: 'chat:send',
  cancel: 'chat:cancel',
  clear: 'chat:clear',
  stream: 'chat:stream',
} as const;

export interface ChatAPI {
  get: (request: ChatGetRequest) => Promise<IPCResult<ChatState>>;
  send: (request: ChatSendRequest) => Promise<IPCResult<ChatSendResponse>>;
  cancel: (request: ChatCancelRequest) => Promise<IPCResult<void>>;
  clear: (request: ChatClearRequest) => Promise<IPCResult<void>>;
  onEvent: (listener: (event: ChatStreamEvent) => void) => () => void;
}
