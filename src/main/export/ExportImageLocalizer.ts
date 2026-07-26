import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExportableArticle } from '../../shared/contracts/export.types';

const MAX_IMAGE_COUNT = 100;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 200 * 1024 * 1024;
const IMAGE_DOWNLOAD_CONCURRENCY = 4;
const IMAGE_REQUEST_TIMEOUT_MS = 20_000;
const MARKDOWN_IMAGE_PATTERN =
  /(!\[[^\]\r\n]*\]\(\s*)(<[^>\r\n]+>|[^\s)\r\n]+)([^)\r\n]*\))/g;

const IMAGE_EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export interface ExportImageLocalizationResult {
  markdown: string;
  assetDirectory?: string;
  downloadedImageCount: number;
  failedImageCount: number;
}

export type ExportImageFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface ImageDownload {
  bytes: Uint8Array;
  extension: string;
}

/**
 * Downloads remote Markdown images beside the export and rewrites their
 * destinations to relative paths. Referer is sourced from the owning article,
 * which is required by CDNs with hotlink protection.
 */
export class ExportImageLocalizer {
  constructor(private readonly imageFetcher: ExportImageFetcher = fetch) {}

  async localize(
    filePath: string,
    markdown: string,
    articles: readonly ExportableArticle[],
  ): Promise<ExportImageLocalizationResult> {
    const imageUrls = collectRemoteMarkdownImageUrls(markdown);
    if (imageUrls.length === 0) {
      return {
        markdown,
        downloadedImageCount: 0,
        failedImageCount: 0,
      };
    }

    const assetDirectory = getAssetDirectory(filePath);
    const replacements = new Map<string, string>();
    let downloadedImageCount = 0;
    let failedImageCount = Math.max(0, imageUrls.length - MAX_IMAGE_COUNT);
    let totalDownloadedBytes = 0;
    const pendingImageUrls = imageUrls.slice(0, MAX_IMAGE_COUNT);
    let nextImageIndex = 0;

    const workers = Array.from(
      {
        length: Math.min(IMAGE_DOWNLOAD_CONCURRENCY, pendingImageUrls.length),
      },
      async () => {
        while (nextImageIndex < pendingImageUrls.length) {
          const imageUrl = pendingImageUrls[nextImageIndex];
          nextImageIndex += 1;
          if (!imageUrl) continue;
          try {
            const referer = findImageReferer(imageUrl, articles);
            const download = await this.download(imageUrl, referer);
            if (totalDownloadedBytes + download.bytes.byteLength > MAX_TOTAL_IMAGE_BYTES) {
              throw new Error('Images exceed the total export size limit.');
            }
            totalDownloadedBytes += download.bytes.byteLength;
            const filename = `${hashImageUrl(imageUrl)}${download.extension}`;
            const imagePath = path.join(assetDirectory, filename);
            await mkdir(assetDirectory, { recursive: true });
            await writeFile(imagePath, download.bytes, { flag: 'w' });
            replacements.set(imageUrl, toMarkdownRelativePath(filePath, imagePath));
            downloadedImageCount += 1;
          } catch {
            // Preserve the original remote URL when localization fails. The
            // returned counts keep this best-effort degradation observable.
            failedImageCount += 1;
          }
        }
      }
    );
    await Promise.all(workers);

    return {
      markdown: rewriteMarkdownImageUrls(markdown, replacements),
      assetDirectory: downloadedImageCount > 0 ? assetDirectory : undefined,
      downloadedImageCount,
      failedImageCount,
    };
  }

  private async download(
    imageUrl: string,
    referer: string | undefined,
  ): Promise<ImageDownload> {
    const response = await this.imageFetcher(imageUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8,*/*;q=0.5',
        'User-Agent': 'Mozilla/5.0 Shale/1.0 Markdown Export',
        ...(referer ? { Referer: referer } : {}),
      },
    });
    if (!response.ok) {
      throw new Error(`Image request failed with HTTP ${response.status}.`);
    }

    const contentType = response.headers.get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    const extension = getSafeImageExtension(imageUrl, contentType);
    if (!extension) {
      throw new Error('Image response has an unsupported content type.');
    }

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      throw new Error('Image response exceeds the export size limit.');
    }

    return {
      bytes: await readBoundedImageBody(response),
      extension,
    };
  }
}

export function collectRemoteMarkdownImageUrls(markdown: string): string[] {
  const urls = new Set<string>();
  for (const match of markdown.matchAll(MARKDOWN_IMAGE_PATTERN)) {
    const imageUrl = unwrapMarkdownDestination(match[2] ?? '');
    if (isRemoteHttpUrl(imageUrl)) urls.add(imageUrl);
  }
  return [...urls];
}

export function rewriteMarkdownImageUrls(
  markdown: string,
  replacements: ReadonlyMap<string, string>,
): string {
  return markdown.replace(
    MARKDOWN_IMAGE_PATTERN,
    (token, prefix: string, destination: string, suffix: string) => {
      const imageUrl = unwrapMarkdownDestination(destination);
      const replacement = replacements.get(imageUrl);
      return replacement ? `${prefix}${replacement}${suffix}` : token;
    },
  );
}

function findImageReferer(
  imageUrl: string,
  articles: readonly ExportableArticle[],
): string | undefined {
  const owner = articles.find((article) =>
    article.cleanedMarkdown.includes(imageUrl)
    || Boolean(article.cleanedHtml?.includes(imageUrl)));
  return sanitizeReferer(owner?.url ?? articles[0]?.url);
}

function getAssetDirectory(filePath: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.assets`);
}

function toMarkdownRelativePath(markdownPath: string, imagePath: string): string {
  const relativePath = path.relative(path.dirname(markdownPath), imagePath);
  return relativePath
    .split(path.sep)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function hashImageUrl(imageUrl: string): string {
  return createHash('sha256').update(imageUrl, 'utf8').digest('hex').slice(0, 20);
}

function unwrapMarkdownDestination(destination: string): string {
  const trimmed = destination.trim();
  return trimmed.startsWith('<') && trimmed.endsWith('>')
    ? trimmed.slice(1, -1)
    : trimmed;
}

function isRemoteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}

function sanitizeReferer(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const referer = new URL(value);
    if (referer.protocol !== 'http:' && referer.protocol !== 'https:') return undefined;
    referer.username = '';
    referer.password = '';
    referer.search = '';
    referer.hash = '';
    return referer.toString();
  } catch {
    return undefined;
  }
}

function getSafeImageExtension(
  imageUrl: string,
  contentType: string | undefined,
): string | undefined {
  if (contentType) return IMAGE_EXTENSION_BY_CONTENT_TYPE[contentType];

  const extension = path.extname(new URL(imageUrl).pathname).toLowerCase();
  return Object.values(IMAGE_EXTENSION_BY_CONTENT_TYPE).includes(extension)
    ? extension
    : undefined;
}

async function readBoundedImageBody(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Image response has no body.');

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error('Image response exceeds the export size limit.');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
