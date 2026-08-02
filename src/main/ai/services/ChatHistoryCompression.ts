import type { ChatMessage } from '../../../shared/contracts/chat.types';

export interface CompressedChatHistory {
  formattedFullHistory: string;
  formattedCompressedHistory: string;
  summarizedMessageIds: number[];
  recentMessages: ChatMessage[];
}

const RECENT_MESSAGE_LIMIT = 6;
const SUMMARY_CONTENT_LIMIT = 600;

export function compressChatHistory(
  messages: readonly ChatMessage[],
  recentMessageLimit = RECENT_MESSAGE_LIMIT,
): CompressedChatHistory {
  const completed = messages.filter((message) => (
    message.status === 'completed' && message.content.trim()
  ));
  const splitIndex = Math.max(0, completed.length - recentMessageLimit);
  const earlyMessages = completed.slice(0, splitIndex);
  const recentMessages = completed.slice(splitIndex);
  return {
    formattedFullHistory: formatHistoryMessages(completed),
    formattedCompressedHistory: [
      ...(earlyMessages.length > 0
        ? [formatStructuredHistorySummary(earlyMessages)]
        : []),
      formatHistoryMessages(recentMessages),
    ].filter(Boolean).join('\n\n'),
    summarizedMessageIds: earlyMessages.map(({ id }) => id),
    recentMessages,
  };
}

export function formatHistoryMessages(
  messages: readonly ChatMessage[],
): string {
  if (messages.length === 0) return '';
  return [
    '<conversation-history mode="original">',
    ...messages.flatMap((message) => [
      `  <message id="${message.id}" role="${message.role}">`,
      escapeXmlText(message.content),
      ...message.attachments.map((attachment) =>
        `    <referenced-attachment id="${attachment.id}" name="${escapeXmlAttribute(attachment.displayName)}" />`),
      '  </message>',
    ]),
    '</conversation-history>',
  ].join('\n');
}

function formatStructuredHistorySummary(
  messages: readonly ChatMessage[],
): string {
  return [
    '<conversation-history mode="compressed-early">',
    '  <summary>',
    ...messages.map((message) => [
      `    <turn id="${message.id}" role="${message.role}">`,
      `      <content>${escapeXmlText(summarizeContent(message.content))}</content>`,
      ...(message.selection
        ? [`      <selection-topic>${escapeXmlText(summarizeContent(message.selection.text))}</selection-topic>`]
        : []),
      ...(message.attachments.length > 0
        ? [`      <attachment-names>${message.attachments.map(({ displayName }) =>
          escapeXmlText(displayName)).join(', ')}</attachment-names>`]
        : []),
      '    </turn>',
    ]).flat(),
    '  </summary>',
    '</conversation-history>',
  ].join('\n');
}

function summarizeContent(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= SUMMARY_CONTENT_LIMIT) return normalized;
  return `${normalized.slice(0, SUMMARY_CONTENT_LIMIT)}…`;
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

