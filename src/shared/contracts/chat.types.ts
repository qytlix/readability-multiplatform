import type { ShaleError } from './feed.ipc';
import type { ProviderKind } from './provider.types';

export const CHAT_PROMPT_VERSION = 'article-chat-v1';
export const CHAT_CONTEXT_MODES = [
  'full',
  'history-compressed',
  'article-map',
] as const;
export type ChatContextMode = (typeof CHAT_CONTEXT_MODES)[number];

export const CHAT_RUN_STATUSES = [
  'running',
  'succeeded',
  'failed',
  'interrupted',
] as const;
export type ChatRunStatus = (typeof CHAT_RUN_STATUSES)[number];

export const CHAT_MESSAGE_STATUSES = [
  'running',
  'completed',
  'failed',
  'interrupted',
] as const;
export type ChatMessageStatus = (typeof CHAT_MESSAGE_STATUSES)[number];

export type ChatMessageRole = 'user' | 'assistant';
export type ChatAttachmentKind = 'text' | 'image';

export interface ChatThread {
  id: number;
  entryId: number;
  sourceContentHash: string;
  contextPromptVersion: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSelectionContext {
  entryId: number;
  text: string;
  paragraphContext: string;
  /** Content-segment identity when the selection can be mapped deterministically. */
  segmentId?: string;
}

/** Public attachment metadata. Storage keys and source paths never cross IPC. */
export interface ChatAttachment {
  id: number;
  threadId: number;
  kind: ChatAttachmentKind;
  displayName: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
  width?: number;
  height?: number;
  expiresAt?: string;
  createdAt: string;
}

export interface ChatMessage {
  id: number;
  threadId: number;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  selection?: ChatSelectionContext;
  articleContextMode: ChatContextMode;
  articleContentHash: string;
  attachments: ChatAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatRun {
  id: number;
  threadId: number;
  userMessageId: number;
  assistantMessageId: number;
  providerProfileId: number;
  providerKind: ProviderKind;
  model: string;
  status: ChatRunStatus;
  promptVersion: string;
  contextMode: ChatContextMode;
  inputContentHash: string;
  error?: ShaleError;
  createdAt: string;
  completedAt?: string;
}

export type ChatState =
  | {
      state: 'idle';
      thread: ChatThread;
      messages: ChatMessage[];
      draftAttachments: ChatAttachment[];
    }
  | {
      state: 'running';
      thread: ChatThread;
      messages: ChatMessage[];
      draftAttachments: ChatAttachment[];
      run: ChatRun;
    }
  | {
      state: 'failed' | 'interrupted';
      thread: ChatThread;
      messages: ChatMessage[];
      draftAttachments: ChatAttachment[];
      run: ChatRun;
    };

export interface ChatGetRequest {
  entryId: number;
}

export interface ChatSendRequest {
  entryId: number;
  question: string;
  selection?: ChatSelectionContext;
  attachmentIds: number[];
}

export interface ChatRetryRequest {
  runId: number;
}

export interface ChatCancelRequest {
  runId: number;
}

export interface ChatAttachmentPickRequest {
  entryId: number;
}

export interface ChatAttachmentImportFailure {
  displayName: string;
  error: ShaleError;
}

export interface ChatAttachmentPickResponse {
  canceled: boolean;
  attachments: ChatAttachment[];
  failures: ChatAttachmentImportFailure[];
}

export interface ChatAttachmentRemoveRequest {
  entryId: number;
  attachmentId: number;
}

export interface ChatAttachmentRemoveResponse {
  removed: boolean;
}

export interface ChatClipboardImageImportRequest {
  entryId: number;
  bytes: Uint8Array;
  suggestedDisplayName: string;
  declaredMimeType: string;
}

export interface ChatClipboardImageImportResponse {
  attachment: ChatAttachment;
}

export interface ChatRunResponse {
  runId: number;
  threadId: number;
  userMessageId: number;
  assistantMessageId: number;
  reused: boolean;
}

interface ChatStreamEventBase {
  runId: number;
  threadId: number;
  entryId: number;
  messageId: number;
}

export type ChatStreamEvent =
  | (ChatStreamEventBase & { type: 'started'; contextMode: ChatContextMode })
  | (ChatStreamEventBase & { type: 'delta'; text: string })
  | (ChatStreamEventBase & { type: 'completed'; message: ChatMessage })
  | (ChatStreamEventBase & { type: 'failed'; error: ShaleError })
  | (ChatStreamEventBase & { type: 'interrupted'; error: ShaleError });
