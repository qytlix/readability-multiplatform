import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ContentCleaner } from '../../src/main/feed/fetcher/ContentCleaner';
import { MarkdownConverter } from '../../src/main/feed/fetcher/MarkdownConverter';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/articles');

describe('ContentCleaner', () => {
  const cleaner = new ContentCleaner();

  it('should clean simple article HTML', () => {
    const html = fs.readFileSync(
      path.join(FIXTURES_DIR, 'simple-article.html'),
      'utf-8',
    );

    const result = cleaner.clean(html, 'https://example.com/article');

    expect(result.title).toBeDefined();
    expect(result.title.length).toBeGreaterThan(0);
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(100);
    // Should NOT contain script content
    expect(result.content).not.toContain('console.log');
    expect(result.content).not.toContain('malicious');
  });

  it('should clean complex article HTML', () => {
    const html = fs.readFileSync(
      path.join(FIXTURES_DIR, 'complex-article.html'),
      'utf-8',
    );

    const result = cleaner.clean(html, 'https://example.com/complex-article');

    expect(result.title).toContain('Complex Article');
    expect(result.content).toContain('table');
    expect(result.content).toContain('fibonacci');
    expect(result.content).toContain('blockquote');
  });

  it('should clean Chinese article HTML', () => {
    const html = fs.readFileSync(
      path.join(FIXTURES_DIR, 'chinese-article.html'),
      'utf-8',
    );

    const result = cleaner.clean(html, 'https://zh-example.com/article');

    expect(result.title).toContain('构建现代 Web 应用');
    expect(result.content).toContain('组件化开发');
    expect(result.content).toContain('虚拟 DOM');
  });

  it('should sanitize scripts and event handlers', () => {
    const result = cleaner.clean(
      `<html><body><article><h1>Test</h1><p>Hello</p></article></body></html>`,
      'https://example.com',
    );

    expect(result.content).not.toContain('<script');
  });

  it('keeps native video playable with safe absolute media URLs', () => {
    const result = cleaner.clean(
      `<html>
        <head><title>Video article</title></head>
        <body>
          <article>
            <h1>Video article</h1>
            <p>This article contains enough explanatory text for the reader extraction.</p>
            <video data-src="/media/movie.mp4" poster="../poster.jpg" autoplay>
              <source src="clips/fallback.webm" type="video/webm">
            </video>
            <p>The video above demonstrates the complete workflow described here.</p>
          </article>
        </body>
      </html>`,
      'https://example.com/posts/article',
    );

    expect(result.content).toContain('controls');
    expect(result.content).toContain('preload="metadata"');
    expect(result.content).toContain('src="https://example.com/media/movie.mp4"');
    expect(result.content).toContain('poster="https://example.com/poster.jpg"');
    expect(result.content).toContain(
      'src="https://example.com/posts/clips/fallback.webm"',
    );
    expect(result.content).not.toContain('autoplay');
    expect(result.content).not.toContain('data-src');
  });
});

describe('MarkdownConverter', () => {
  const converter = new MarkdownConverter();

  it('should convert HTML to Markdown', () => {
    const html = '<h1>Title</h1><p>Hello <strong>world</strong>!</p>';
    const md = converter.convert(html);

    expect(md).toContain('# Title');
    expect(md).toContain('**world**');
  });

  it('should preserve links', () => {
    const html = '<a href="https://example.com">Example</a>';
    const md = converter.convert(html);

    expect(md).toContain('[Example](https://example.com)');
  });

  it('should preserve images', () => {
    const html = '<img src="https://example.com/img.jpg" alt="Photo" />';
    const md = converter.convert(html);

    expect(md).toContain('![Photo](https://example.com/img.jpg)');
  });

  it('should handle code blocks', () => {
    const html = '<pre><code>const x = 1;</code></pre>';
    const md = converter.convert(html);

    expect(md).toContain('```');
    expect(md).toContain('const x = 1;');
  });
});
