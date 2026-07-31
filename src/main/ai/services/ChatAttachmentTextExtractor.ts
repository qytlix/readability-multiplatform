import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import {
  CHAT_ERROR_CODES,
  ChatError,
} from '../../../shared/errors/chat.errors';

export const CHAT_TEXT_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
export const CHAT_TEXT_ATTACHMENT_MAX_CHARACTERS = 200_000;
export const CHAT_PDF_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

export type DetectedChatAttachmentType =
  | 'text'
  | 'html'
  | 'pdf'
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'unsupported';

export interface ExtractedChatTextAttachment {
  mimeType: 'text/plain' | 'text/html';
  textContent: string;
  byteSize: number;
  contentHash: string;
}

const PDF_SIGNATURE = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
const PNG_SIGNATURE = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_SIGNATURE = Uint8Array.from([0xff, 0xd8, 0xff]);

const hasPrefix = (bytes: Uint8Array, signature: Uint8Array): boolean => (
  bytes.length >= signature.length
  && signature.every((value, index) => bytes[index] === value)
);

const decodeUtf8 = (bytes: Uint8Array): string | null => {
  try {
    return new TextDecoder('utf-8', { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, '');
  } catch {
    return null;
  }
};

const looksLikeHtml = (text: string): boolean => {
  const prefix = text.trimStart().slice(0, 2_048).toLowerCase();
  return prefix.startsWith('<!doctype html')
    || prefix.startsWith('<html')
    || /<(article|body|head|main|p|section)(?:\s|>)/u.test(prefix);
};

const isWebp = (bytes: Uint8Array): boolean => (
  bytes.length >= 12
  && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
  && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
);

export const detectChatAttachmentType = (
  bytes: Uint8Array,
): DetectedChatAttachmentType => {
  if (hasPrefix(bytes, PDF_SIGNATURE)) return 'pdf';
  if (hasPrefix(bytes, PNG_SIGNATURE)) return 'png';
  if (hasPrefix(bytes, JPEG_SIGNATURE)) return 'jpeg';
  if (isWebp(bytes)) return 'webp';

  const decoded = decodeUtf8(bytes);
  if (decoded === null || decoded.includes('\u0000')) return 'unsupported';
  return looksLikeHtml(decoded) ? 'html' : 'text';
};

export const extractChatTextAttachment = (
  bytes: Uint8Array,
): ExtractedChatTextAttachment => {
  if (bytes.length === 0) {
    throw new ChatError(
      CHAT_ERROR_CODES.CHAT_ATTACHMENT_PARSE_FAILED,
      'The selected attachment is empty.',
      false,
    );
  }
  if (bytes.length > CHAT_TEXT_ATTACHMENT_MAX_BYTES) {
    throw new ChatError(
      CHAT_ERROR_CODES.CHAT_ATTACHMENT_TOO_LARGE,
      'Text and HTML attachments must be 2 MB or smaller.',
      false,
    );
  }

  const detectedType = detectChatAttachmentType(bytes);
  if (detectedType !== 'text' && detectedType !== 'html') {
    throw new ChatError(
      CHAT_ERROR_CODES.CHAT_ATTACHMENT_TYPE_UNSUPPORTED,
      'The selected file is not a supported text or HTML attachment.',
      false,
    );
  }
  const decoded = decodeUtf8(bytes);
  if (decoded === null) {
    throw new ChatError(
      CHAT_ERROR_CODES.CHAT_ATTACHMENT_PARSE_FAILED,
      'The selected text attachment is not valid UTF-8.',
      false,
    );
  }

  const textContent = detectedType === 'html'
    ? htmlToMarkdown(decoded)
    : normalizePlainText(decoded);
  if (!textContent) {
    throw new ChatError(
      CHAT_ERROR_CODES.CHAT_ATTACHMENT_PARSE_FAILED,
      'The selected attachment does not contain readable text.',
      false,
    );
  }
  if (textContent.length > CHAT_TEXT_ATTACHMENT_MAX_CHARACTERS) {
    throw new ChatError(
      CHAT_ERROR_CODES.CHAT_ATTACHMENT_TOO_LARGE,
      'The extracted attachment text is too large for Article Chat.',
      false,
    );
  }

  return {
    mimeType: detectedType === 'html' ? 'text/html' : 'text/plain',
    textContent,
    byteSize: bytes.length,
    contentHash: createHash('sha256').update(bytes).digest('hex'),
  };
};

const normalizePlainText = (text: string): string => text
  .replace(/\r\n?/gu, '\n')
  .trim();

const htmlToMarkdown = (html: string): string => {
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    document.querySelectorAll(
      'script, style, noscript, template, iframe, object, embed',
    ).forEach((element) => element.remove());
    const turndown = new TurndownService({
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '_',
      headingStyle: 'atx',
      strongDelimiter: '**',
    });
    return normalizePlainText(turndown.turndown(document.body.innerHTML));
  } catch {
    throw new ChatError(
      CHAT_ERROR_CODES.CHAT_ATTACHMENT_PARSE_FAILED,
      'The selected HTML attachment could not be parsed.',
      false,
    );
  }
};
