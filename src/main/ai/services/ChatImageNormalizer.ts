import { createHash } from 'node:crypto';
import { nativeImage } from 'electron';
import {
  CHAT_ERROR_CODES,
  ChatError,
} from '../../../shared/errors/chat.errors';
import {
  detectChatAttachmentType,
  type DetectedChatAttachmentType,
} from './ChatAttachmentTextExtractor';

export const CHAT_IMAGE_NORMALIZATION_VERSION = 'chat-image-v1';
export const CHAT_IMAGE_MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const CHAT_IMAGE_MAX_NORMALIZED_BYTES = 8 * 1024 * 1024;
export const CHAT_IMAGE_MAX_DIMENSION = 10_000;
export const CHAT_IMAGE_MAX_PIXELS = 40_000_000;
export const CHAT_IMAGE_TARGET_LONG_EDGE = 2_048;

export interface ChatDecodedImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(options: {
    width: number;
    height: number;
    quality: 'best';
  }): ChatDecodedImage;
  toBitmap(): Uint8Array;
  toJPEG(quality: number): Uint8Array;
  toPNG(): Uint8Array;
}

export interface ChatImageDecoder {
  createFromBuffer(bytes: Uint8Array): ChatDecodedImage;
}

const electronImageDecoder: ChatImageDecoder = {
  createFromBuffer: (bytes) => nativeImage.createFromBuffer(Buffer.from(bytes)),
};

export interface NormalizedChatImage {
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
  byteSize: number;
  width: number;
  height: number;
  contentHash: string;
  normalizationVersion: typeof CHAT_IMAGE_NORMALIZATION_VERSION;
}

export const normalizeChatImage = (
  sourceBytes: Uint8Array,
  decoder: ChatImageDecoder = electronImageDecoder,
): NormalizedChatImage => {
  if (
    sourceBytes.length === 0
    || sourceBytes.length > CHAT_IMAGE_MAX_INPUT_BYTES
  ) {
    throw new ChatError(
      CHAT_ERROR_CODES.CHAT_IMAGE_TOO_LARGE,
      'Images must be non-empty and 10 MB or smaller.',
      false,
    );
  }

  const sourceType = detectChatAttachmentType(sourceBytes);
  if (!isSupportedImageType(sourceType)) {
    throw new ChatError(
      CHAT_ERROR_CODES.CHAT_ATTACHMENT_TYPE_UNSUPPORTED,
      'Only PNG, JPEG, and WebP images are supported.',
      false,
    );
  }

  const decoded = decoder.createFromBuffer(sourceBytes);
  if (decoded.isEmpty()) {
    throw new ChatError(
      CHAT_ERROR_CODES.CHAT_IMAGE_INVALID,
      'The selected image could not be decoded.',
      false,
    );
  }
  const originalSize = decoded.getSize();
  validateImageDimensions(originalSize.width, originalSize.height);

  const resized = resizeForProvider(decoded, originalSize.width, originalSize.height);
  const { width, height } = resized.getSize();
  const preserveTransparency = sourceType === 'png' || imageHasTransparency(resized);
  const mimeType = preserveTransparency ? 'image/png' as const : 'image/jpeg' as const;
  const normalizedBytes = Uint8Array.from(
    preserveTransparency ? resized.toPNG() : resized.toJPEG(85),
  );
  if (
    normalizedBytes.length === 0
    || normalizedBytes.length > CHAT_IMAGE_MAX_NORMALIZED_BYTES
  ) {
    throw new ChatError(
      CHAT_ERROR_CODES.CHAT_IMAGE_TOO_LARGE,
      'The normalized image exceeds the 8 MB model-input limit.',
      false,
    );
  }
  const contentHash = createHash('sha256')
    .update(CHAT_IMAGE_NORMALIZATION_VERSION, 'utf8')
    .update('\0')
    .update(mimeType, 'utf8')
    .update('\0')
    .update(normalizedBytes)
    .digest('hex');

  return {
    bytes: normalizedBytes,
    mimeType,
    byteSize: normalizedBytes.length,
    width,
    height,
    contentHash,
    normalizationVersion: CHAT_IMAGE_NORMALIZATION_VERSION,
  };
};

const isSupportedImageType = (
  type: DetectedChatAttachmentType,
): type is 'png' | 'jpeg' | 'webp' => (
  type === 'png' || type === 'jpeg' || type === 'webp'
);

const validateImageDimensions = (width: number, height: number): void => {
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width <= 0
    || height <= 0
    || width > CHAT_IMAGE_MAX_DIMENSION
    || height > CHAT_IMAGE_MAX_DIMENSION
    || width * height > CHAT_IMAGE_MAX_PIXELS
  ) {
    throw new ChatError(
      CHAT_ERROR_CODES.CHAT_IMAGE_DIMENSIONS_UNSAFE,
      'The image dimensions exceed the safe decoding limit.',
      false,
    );
  }
};

const resizeForProvider = (
  image: ChatDecodedImage,
  width: number,
  height: number,
): ChatDecodedImage => {
  const longEdge = Math.max(width, height);
  if (longEdge <= CHAT_IMAGE_TARGET_LONG_EDGE) return image;
  const scale = CHAT_IMAGE_TARGET_LONG_EDGE / longEdge;
  return image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: 'best',
  });
};

const imageHasTransparency = (image: ChatDecodedImage): boolean => {
  const bitmap = image.toBitmap();
  for (let index = 3; index < bitmap.length; index += 4) {
    if (bitmap[index] !== 255) return true;
  }
  return false;
};
