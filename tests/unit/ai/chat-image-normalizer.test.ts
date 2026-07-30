import { describe, expect, it, vi } from 'vitest';
import {
  normalizeChatImage,
  type ChatDecodedImage,
  type ChatImageDecoder,
} from '../../../src/main/ai/services/ChatImageNormalizer';

const PNG_SIGNATURE = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_SIGNATURE = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP_SIGNATURE = new TextEncoder().encode('RIFF____WEBP');

describe('Article Chat image normalization', () => {
  it('re-encodes PNG input and preserves its alpha-capable format', () => {
    const image = createImage({ width: 800, height: 600, alpha: 255 });
    const normalized = normalizeChatImage(
      PNG_SIGNATURE,
      createDecoder(image),
    );

    expect(normalized).toMatchObject({
      mimeType: 'image/png',
      width: 800,
      height: 600,
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      normalizationVersion: 'chat-image-v1',
    });
    expect(image.toPNG).toHaveBeenCalledTimes(1);
    expect(image.toJPEG).not.toHaveBeenCalled();
  });

  it('normalizes opaque JPEG and WebP input to JPEG', () => {
    for (const source of [JPEG_SIGNATURE, WEBP_SIGNATURE]) {
      const image = createImage({ width: 640, height: 480, alpha: 255 });
      expect(normalizeChatImage(source, createDecoder(image)).mimeType)
        .toBe('image/jpeg');
      expect(image.toJPEG).toHaveBeenCalledWith(85);
    }
  });

  it('normalizes transparent WebP input to PNG', () => {
    const image = createImage({ width: 640, height: 480, alpha: 120 });
    const normalized = normalizeChatImage(
      WEBP_SIGNATURE,
      createDecoder(image),
    );

    expect(normalized.mimeType).toBe('image/png');
    expect(image.toPNG).toHaveBeenCalledTimes(1);
  });

  it('resizes a safe large image to the provider long-edge budget', () => {
    const resized = createImage({ width: 2_048, height: 1_024, alpha: 255 });
    const original = createImage({
      width: 4_000,
      height: 2_000,
      alpha: 255,
      resized,
    });

    const normalized = normalizeChatImage(
      JPEG_SIGNATURE,
      createDecoder(original),
    );

    expect(original.resize).toHaveBeenCalledWith({
      width: 2_048,
      height: 1_024,
      quality: 'best',
    });
    expect(normalized).toMatchObject({ width: 2_048, height: 1_024 });
  });

  it('rejects unsafe pixel dimensions before re-encoding', () => {
    const image = createImage({ width: 9_000, height: 9_000, alpha: 255 });
    expect(() => normalizeChatImage(
      JPEG_SIGNATURE,
      createDecoder(image),
    )).toThrowError(expect.objectContaining({
      code: 'CHAT_IMAGE_DIMENSIONS_UNSAFE',
    }));
    expect(image.toJPEG).not.toHaveBeenCalled();
  });

  it('rejects renamed unsupported bytes before invoking the decoder', () => {
    const decoder = { createFromBuffer: vi.fn() };
    expect(() => normalizeChatImage(
      new TextEncoder().encode('not an image'),
      decoder as unknown as ChatImageDecoder,
    )).toThrowError(expect.objectContaining({
      code: 'CHAT_ATTACHMENT_TYPE_UNSUPPORTED',
    }));
    expect(decoder.createFromBuffer).not.toHaveBeenCalled();
  });
});

function createDecoder(image: ChatDecodedImage): ChatImageDecoder {
  return {
    createFromBuffer: vi.fn(() => image),
  };
}

function createImage({
  width,
  height,
  alpha,
  resized,
}: {
  width: number;
  height: number;
  alpha: number;
  resized?: ChatDecodedImage;
}): ChatDecodedImage & {
  resize: ReturnType<typeof vi.fn>;
  toJPEG: ReturnType<typeof vi.fn>;
  toPNG: ReturnType<typeof vi.fn>;
} {
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: vi.fn((): ChatDecodedImage => resized ?? image),
    toBitmap: () => Uint8Array.from([0, 0, 0, alpha]),
    toJPEG: vi.fn(() => Uint8Array.from([0xff, 0xd8, 0xff, 0x01])),
    toPNG: vi.fn(() => Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x01,
    ])),
  };
  return image;
}
