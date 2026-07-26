import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExportableArticle } from '../../../src/shared/contracts/export.types';
import {
  collectRemoteMarkdownImageUrls,
  ExportImageLocalizer,
  rewriteMarkdownImageUrls,
  type ExportImageFetcher,
} from '../../../src/main/export/ExportImageLocalizer';

const IMAGE_URL =
  'https://cdnfile.sspai.com/2026/07/17/e473cdc217755a2d0969293ebf098377.jpg';
const ARTICLE_URL = 'https://sspai.com/post/112421';
const IMAGE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'shale-export-images-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createArticle(): ExportableArticle {
  return {
    entryId: 1,
    title: '手冲咖啡指北',
    url: ARTICLE_URL,
    cleanedMarkdown: `正文\n\n![](${IMAGE_URL})`,
  };
}

describe('ExportImageLocalizer', () => {
  it('downloads a protected image with the article Referer and rewrites it locally', async () => {
    const fetcher = vi.fn<ExportImageFetcher>(async (_input, init) => {
      expect(new Headers(init?.headers).get('Referer')).toBe(ARTICLE_URL);
      return new Response(IMAGE_BYTES, {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': String(IMAGE_BYTES.byteLength),
        },
      });
    });
    const exportDirectory = createTemporaryDirectory();
    const markdownPath = path.join(exportDirectory, '冰手冲文章.md');
    const markdown = `正文\n\n![](${IMAGE_URL})\n\n![](${IMAGE_URL})`;

    const result = await new ExportImageLocalizer(fetcher).localize(
      markdownPath,
      markdown,
      [createArticle()],
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.downloadedImageCount).toBe(1);
    expect(result.failedImageCount).toBe(0);
    expect(result.assetDirectory).toBe(path.join(exportDirectory, '冰手冲文章.assets'));
    expect(result.markdown).not.toContain(IMAGE_URL);
    expect(result.markdown).toMatch(
      /!\[]\(%E5%86%B0%E6%89%8B%E5%86%B2%E6%96%87%E7%AB%A0\.assets\/[a-f0-9]{20}\.jpg\)/,
    );

    const assetName = path.basename(
      decodeURIComponent(collectRemoteOrLocalImageDestinations(result.markdown)[0] ?? ''),
    );
    const assetPath = path.join(result.assetDirectory ?? '', assetName);
    expect(existsSync(assetPath)).toBe(true);
    expect(new Uint8Array(readFileSync(assetPath))).toEqual(IMAGE_BYTES);
  });

  it('preserves the remote URL and reports a failed localization', async () => {
    const fetcher = vi.fn<ExportImageFetcher>(async () =>
      new Response('Forbidden', {
        status: 403,
        headers: { 'Content-Type': 'text/html' },
      }));
    const exportDirectory = createTemporaryDirectory();
    const markdownPath = path.join(exportDirectory, 'article.md');
    const markdown = `![](${IMAGE_URL})`;

    const result = await new ExportImageLocalizer(fetcher).localize(
      markdownPath,
      markdown,
      [createArticle()],
    );

    expect(result.markdown).toBe(markdown);
    expect(result.downloadedImageCount).toBe(0);
    expect(result.failedImageCount).toBe(1);
    expect(result.assetDirectory).toBeUndefined();
  });

  it('rejects a successful HTML response masquerading behind an image URL', async () => {
    const fetcher = vi.fn<ExportImageFetcher>(async () =>
      new Response('<html>hotlink denied</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }));
    const exportDirectory = createTemporaryDirectory();
    const markdown = `![](${IMAGE_URL})`;

    const result = await new ExportImageLocalizer(fetcher).localize(
      path.join(exportDirectory, 'article.md'),
      markdown,
      [createArticle()],
    );

    expect(result.markdown).toBe(markdown);
    expect(result.downloadedImageCount).toBe(0);
    expect(result.failedImageCount).toBe(1);
  });
});

describe('Markdown image URL helpers', () => {
  it('collects unique HTTP images without treating regular links as images', () => {
    const markdown = [
      `![](${IMAGE_URL})`,
      `![again](<${IMAGE_URL}>)`,
      '[article](https://sspai.com/post/112421)',
      '![local](./image.jpg)',
    ].join('\n');

    expect(collectRemoteMarkdownImageUrls(markdown)).toEqual([IMAGE_URL]);
  });

  it('rewrites only matching image destinations', () => {
    const markdown = `![](${IMAGE_URL})\n\n[article](${IMAGE_URL})`;
    const result = rewriteMarkdownImageUrls(
      markdown,
      new Map([[IMAGE_URL, 'article.assets/image.jpg']]),
    );

    expect(result).toBe(
      `![](article.assets/image.jpg)\n\n[article](${IMAGE_URL})`,
    );
  });
});

function collectRemoteOrLocalImageDestinations(markdown: string): string[] {
  return [...markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1] ?? '');
}
