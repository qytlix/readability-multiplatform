import { describe, expect, it } from 'vitest';
import { extractChatPdfAttachment } from '../../../src/main/ai/services/ChatPdfTextExtractor';

describe('Article Chat PDF text extraction', () => {
  it('extracts selectable text without executing PDF content', async () => {
    const extracted = await extractChatPdfAttachment(
      createPdfFixture('Evidence from PDF'),
    );

    expect(extracted).toMatchObject({
      mimeType: 'application/pdf',
      textContent: 'Evidence from PDF',
      pageCount: 1,
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it('rejects a PDF without selectable text instead of treating it as empty', async () => {
    await expect(extractChatPdfAttachment(
      createPdfFixture(''),
    )).rejects.toMatchObject({
      code: 'CHAT_PDF_TEXT_UNAVAILABLE',
    });
  });

  it('rejects corrupt bytes that merely start with a PDF signature', async () => {
    await expect(extractChatPdfAttachment(
      new TextEncoder().encode('%PDF-not-a-document'),
    )).rejects.toMatchObject({
      code: 'CHAT_ATTACHMENT_PARSE_FAILED',
    });
  });
});

function createPdfFixture(text: string): Uint8Array {
  const escapedText = text.replace(/([\\()])/gu, '\\$1');
  const stream = text
    ? `BT /F1 12 Tf 72 720 Td (${escapedText}) Tj ET`
    : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
      + '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = source.length;
  source += `xref\n0 ${objects.length + 1}\n`;
  source += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    source += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  source += 'trailer\n';
  source += `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  source += `startxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(source);
}
