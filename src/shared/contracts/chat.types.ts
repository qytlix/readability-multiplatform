import type { ShaleError } from './feed.ipc';

export type ChatMessageRole = 'user' | 'assistant';
export type ChatMessageStatus =
  | 'succeeded'
  | 'streaming'
  | 'failed'
  | 'interrupted';
export type ChatRunStatus = 'running' | 'succeeded' | 'failed' | 'interrupted';

export interface ChatMessage {
  id: number;
  threadId: number;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ChatRun {
  id: number;
  threadId: number;
  entryId: number;
  userMessageId: number;
  assistantMessageId: number;
  status: ChatRunStatus;
  error?: ShaleError;
  createdAt: string;
  completedAt?: string;
}

export interface ChatState {
  entryId: number;
  threadId?: number;
  messages: ChatMessage[];
  activeRun?: ChatRun;
}

export interface ChatGetRequest {
  entryId: number;
}

export interface ChatSendRequest extends ChatGetRequest {
  question: string;
}

export interface ChatSendResponse {
  runId: number;
  threadId: number;
  userMessageId: number;
  assistantMessageId: number;
}

export interface ChatCancelRequest {
  runId: number;
}

export interface ChatClearRequest {
  entryId: number;
}

interface ChatStreamEventBase {
  runId: number;
  threadId: number;
  entryId: number;
  messageId: number;
}

export type ChatStreamEvent =
  | (ChatStreamEventBase & { type: 'started' })
  | (ChatStreamEventBase & { type: 'delta'; text: string })
  | (ChatStreamEventBase & { type: 'completed'; message: ChatMessage })
  | (ChatStreamEventBase & { type: 'failed'; error: ShaleError });
