import { createHash } from 'node:crypto';
import {
  getDocument,
  PasswordException,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  CHAT_ERROR_CODES,
  ChatError,
} from '../../../shared/errors/chat.errors';
import {
  CHAT_PDF_ATTACHMENT_MAX_BYTES,
  CHAT_TEXT_ATTACHMENT_MAX_CHARACTERS,
  detectChatAttachmentType,
} from './ChatAttachmentTextExtractor';

export const CHAT_PDF_MAX_PAGES = 250;

export interface ExtractedChatPdfAttachment {
  mimeType: 'application/pdf';
  textContent: string;
  byteSize: number;
  contentHash: string;
  pageCount: number;
}

export const extractChatPdfAttachment = async (
  sourceBytes: Uint8Array,
): Promise<ExtractedChatPdfAttachment> => {
  if (sourceBytes.length > CHAT_PDF_ATTACHMENT_MAX_BYTES) {
    throw new ChatError(
      CHAT_ERROR_CODES.CHAT_ATTACHMENT_TOO_LARGE,
      'PDF attachments must be 20 MB or smaller.',
      false,
    );
  }
  if (detectChatAttachmentType(sourceBytes) !== 'pdf') {
    throw new ChatError(
      CHAT_ERROR_CODES.CHAT_ATTACHMENT_TYPE_UNSUPPORTED,
      'The selected file is not a valid PDF attachment.',
      false,
    );
  }

  const bytes = Uint8Array.from(sourceBytes);
  const loadingTask = getDocument({
    data: bytes,
    disableFontFace: true,
    enableXfa: false,
    isImageDecoderSupported: false,
    isOffscreenCanvasSupported: false,
    stopAtErrors: true,
    useSystemFonts: false,
    useWasm: false,
  });

  try {
    const document = await loadingTask.promise;
    if (document.numPages > CHAT_PDF_MAX_PAGES) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_ATTACHMENT_TOO_LARGE,
        `PDF attachments can contain at most ${CHAT_PDF_MAX_PAGES} pages.`,
        false,
      );
    }

    const pages: string[] = [];
    let extractedCharacters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .flatMap((item): string[] => {
          if (!('str' in item)) return [];
          const text = item.str.trim();
          if (!text) return item.hasEOL ? ['\n'] : [];
          return [item.hasEOL ? `${text}\n` : text];
        })
        .join(' ')
        .replace(/[ \t]+\n/gu, '\n')
        .replace(/\n[ \t]+/gu, '\n')
        .replace(/[ \t]{2,}/gu, ' ')
        .trim();
      extractedCharacters += pageText.length;
      if (extractedCharacters > CHAT_TEXT_ATTACHMENT_MAX_CHARACTERS) {
        throw new ChatError(
          CHAT_ERROR_CODES.CHAT_ATTACHMENT_TOO_LARGE,
          'The extracted PDF text is too large for Article Chat.',
          false,
        );
      }
      if (pageText) pages.push(pageText);
    }

    const textContent = pages.join('\n\n').trim();
    if (!textContent) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_PDF_TEXT_UNAVAILABLE,
        'This PDF does not contain selectable text. OCR is not supported.',
        false,
      );
    }

    return {
      mimeType: 'application/pdf',
      textContent,
      byteSize: sourceBytes.length,
      contentHash: createHash('sha256').update(sourceBytes).digest('hex'),
      pageCount: document.numPages,
    };
  } catch (error) {
    if (error instanceof ChatError) throw error;
    if (error instanceof PasswordException) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_PDF_ENCRYPTED,
        'Encrypted PDF attachments are not supported.',
        false,
      );
    }
    throw new ChatError(
      CHAT_ERROR_CODES.CHAT_ATTACHMENT_PARSE_FAILED,
      'The selected PDF attachment could not be parsed.',
      false,
    );
  } finally {
    await loadingTask.destroy();
  }
};
