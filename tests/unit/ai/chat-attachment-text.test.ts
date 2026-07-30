import { describe, expect, it } from 'vitest';
import {
  detectChatAttachmentType,
  extractChatTextAttachment,
} from '../../../src/main/ai/services/ChatAttachmentTextExtractor';

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('Article Chat text attachment extraction', () => {
  it('identifies HTML from content and removes executable elements', () => {
    const extracted = extractChatTextAttachment(bytes(`
      <!doctype html>
      <html>
        <body>
          <h1>Evidence</h1>
          <p>Readable paragraph.</p>
          <script>stealCredentials()</script>
        </body>
      </html>
    `));

    expect(extracted).toMatchObject({
      mimeType: 'text/html',
      byteSize: expect.any(Number),
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(extracted.textContent).toContain('# Evidence');
    expect(extracted.textContent).toContain('Readable paragraph.');
    expect(extracted.textContent).not.toContain('stealCredentials');
  });

  it('normalizes valid UTF-8 plain text', () => {
    expect(extractChatTextAttachment(
      bytes('\uFEFFfirst\r\nsecond\rthird'),
    )).toMatchObject({
      mimeType: 'text/plain',
      textContent: 'first\nsecond\nthird',
    });
  });

  it('does not trust a filename or declared type to turn binary into text', () => {
    expect(detectChatAttachmentType(Uint8Array.from([
      0x66, 0x61, 0x6b, 0x65, 0x00, 0xff,
    ]))).toBe('unsupported');
    expect(() => extractChatTextAttachment(Uint8Array.from([
      0x66, 0x61, 0x6b, 0x65, 0x00, 0xff,
    ]))).toThrowError(expect.objectContaining({
      code: 'CHAT_ATTACHMENT_TYPE_UNSUPPORTED',
    }));
  });

  it.each([
    ['PDF', Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d])],
    ['PNG', Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ])],
    ['JPEG', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])],
    ['WebP', bytes('RIFF____WEBP')],
  ])('recognizes the %s signature before text decoding', (_label, content) => {
    expect(detectChatAttachmentType(content)).not.toBe('text');
  });

  it('rejects empty and over-budget extracted content instead of truncating', () => {
    expect(() => extractChatTextAttachment(new Uint8Array())).toThrowError(
      expect.objectContaining({ code: 'CHAT_ATTACHMENT_PARSE_FAILED' }),
    );
    expect(() => extractChatTextAttachment(
      bytes('x'.repeat(200_001)),
    )).toThrowError(expect.objectContaining({
      code: 'CHAT_ATTACHMENT_TOO_LARGE',
    }));
  });
});
