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

  it('removes publisher chrome outside the primary article root', () => {
    const articleParagraph = (
      '正文段落保留站内链接和文章本身的信息，同时提供足够文本供正文提取器稳定识别。'
    ).repeat(12);
    const result = cleaner.clean(
      `<html>
        <head><title>我的 AI 编程旅程 Part 1</title></head>
        <body>
          <div id="container">
            <header>
              <h1><a href="/">Paradigm X</a></h1>
              <p><em>Vision quests of a soulhacker</em></p>
            </header>
            <nav>
              <ul>
                <li><a href="/posts/">全部文章</a></li>
                <li><a href="/tags/">标签</a></li>
                <li><a href="/about/">关于</a></li>
              </ul>
            </nav>
            <main>
              <article>
                <h1>我的 AI 编程旅程 Part 1</h1>
                <p>${articleParagraph}</p>
                <p><a href="/posts/good-code/">文章中的相关链接</a></p>
                <p>${articleParagraph}</p>
              </article>
            </main>
          </div>
        </body>
      </html>`,
      'https://soulhacker.me/posts/ai-coding-pt1/',
    );

    expect(result.content).toContain('正文段落保留站内链接');
    expect(result.content).toContain('文章中的相关链接');
    expect(result.content).not.toContain('Paradigm X');
    expect(result.content).not.toContain('Vision quests of a soulhacker');
    expect(result.content).not.toContain('全部文章');
    expect(result.content).not.toContain('标签');
    expect(result.content).not.toContain('关于');
  });

  it('removes publisher chrome from stale cached Reader HTML', () => {
    const cleanedHtml = cleaner.cleanStoredHtml(
      `<div id="readability-page-1">
        <div id="container">
          <header>
            <h2><a href="https://soulhacker.me/">Paradigm X</a></h2>
            <p><em>Vision quests of a soulhacker</em></p>
          </header>
          <nav>
            <a href="https://soulhacker.me/posts/">全部文章</a>
            <a href="https://soulhacker.me/tags/">标签</a>
            <a href="https://soulhacker.me/about/">关于</a>
          </nav>
          <main>
            <article>
              <p>应当保留的正文内容。</p>
            </article>
          </main>
        </div>
      </div>`,
    );

    expect(cleanedHtml).toContain('应当保留的正文内容');
    expect(cleanedHtml).not.toContain('Paradigm X');
    expect(cleanedHtml).not.toContain('Vision quests of a soulhacker');
    expect(cleanedHtml).not.toContain('全部文章');
  });

  it('should sanitize scripts and event handlers', () => {
    const result = cleaner.clean(
      `<html><body><article><h1>Test</h1><p>Hello</p></article></body></html>`,
      'https://example.com',
    );

    expect(result.content).not.toContain('<script');
  });

  it('excludes CSS-hidden runtime payloads before Readability scoring', () => {
    const hiddenPayload = JSON.stringify({
      ENV: 'production',
      ARC_ACCESS_TOKEN_PROD: 'encoded-token-'.repeat(80),
      GRAPHQL_KEY: 'encoded-key-'.repeat(80),
    });
    const result = cleaner.clean(
      `<html>
        <head><title>Live article</title></head>
        <body>
          <div id="fusion-app">
            <main>
              <article>
                <h1>Live article</h1>
                <p>The actual article explains the complete story in enough detail for Reader extraction.</p>
                <p>This second paragraph contains the remaining reporting that readers should keep.</p>
              </article>
            </main>
          </div>
          <div id="stream-context" class="hidden">${hiddenPayload}</div>
        </body>
      </html>`,
      'https://example.com/live/article',
    );

    expect(result.content).toContain('The actual article');
    expect(result.content).not.toContain('ARC_ACCESS_TOKEN_PROD');
    expect(result.content).not.toContain('encoded-token');
  });

  it('preserves meaningful figures inside misleading header-like wrappers', () => {
    const articleParagraph = (
      'The live report contains verified reporting, background, and analysis. '
    ).repeat(12);
    const result = cleaner.clean(
      `<html>
        <head><title>Live report</title></head>
        <body>
          <main>
            <article>
              <div class="liveblog-header">
                <figure>
                  <img
                    src="/images/hero.jpg"
                    alt="Players celebrating after the game"
                    width="1200"
                    height="800"
                  >
                  <figcaption>The team celebrates its victory.</figcaption>
                </figure>
              </div>
              <p>${articleParagraph}</p>
              <p>${articleParagraph}</p>
            </article>
          </main>
        </body>
      </html>`,
      'https://example.com/sports/live-report',
    );

    expect(result.content).toContain(
      'src="https://example.com/images/hero.jpg"',
    );
    expect(result.content).toContain('The team celebrates its victory.');
  });

  it('removes publisher placeholder icons before Readability drops icon classes', () => {
    const articleParagraph = (
      'The article contains enough useful reporting and explanation for Reader extraction. '
    ).repeat(12);
    const result = cleaner.clean(
      `<html>
        <head><title>Publisher article</title></head>
        <body>
          <article>
            <p>
              <span>
                <img
                  class="article__header__tag__icon"
                  src="https://cdn.example.com/ui/img-placeholder.png"
                  alt="Featured"
                >
                <span>Featured</span>
              </span>
            </p>
            <h1>Publisher article</h1>
            <p>${articleParagraph}</p>
            <p>${articleParagraph}</p>
          </article>
        </body>
      </html>`,
      'https://example.com/posts/article',
    );

    expect(result.content).toContain('Featured');
    expect(result.content).not.toContain('img-placeholder.png');
    expect(result.content).not.toContain('alt="Featured"');
  });

  it('uses real lazy image sources and drops unresolved placeholder images', () => {
    const articleParagraph = (
      'The article contains enough useful reporting and explanation for Reader extraction. '
    ).repeat(12);
    const result = cleaner.clean(
      `<html>
        <head><title>Lazy image article</title></head>
        <body>
          <article>
            <h1>Lazy image article</h1>
            <p>${articleParagraph}</p>
            <figure>
              <img
                src="/assets/image-placeholder.png"
                data-src="/photos/real-photo.jpg"
                alt="Article photo"
              >
            </figure>
            <p>
              <img src="/assets/img-placeholder.png" alt="Unresolved placeholder">
            </p>
            <p>${articleParagraph}</p>
          </article>
        </body>
      </html>`,
      'https://example.com/posts/article',
    );

    expect(result.content).toContain(
      'src="https://example.com/photos/real-photo.jpg"',
    );
    expect(result.content).not.toContain('data-src');
    expect(result.content).not.toContain('placeholder.png');
    expect(result.content).not.toContain('Unresolved placeholder');
  });

  it('restores Arc Fusion images from structured article metadata', () => {
    const fusionContent = {
      type: 'story',
      headlines: { basic: 'Structured live report' },
      promo_items: {
        basic: {
          _id: 'hero-image',
          type: 'image',
          imageWebUrl: 'https://cdn.example.com/hero.jpg',
          caption: 'The article hero image.',
          width: 1200,
          height: 800,
        },
      },
      content_elements: [
        {
          type: 'header',
          level: 2,
          content: 'First update',
        },
        {
          type: 'text',
          content: 'The first update contains the opening article paragraph.',
        },
        {
          _id: 'body-image',
          type: 'image',
          imageWebUrl: 'https://cdn.example.com/body.jpg',
          caption: 'The body image caption.',
          credits: {
            by: [{ name: 'Example Photographer' }],
          },
          width: 1000,
          height: 667,
        },
        {
          type: 'text',
          content: 'The final update completes the structured live report.',
        },
      ],
    };
    const result = cleaner.clean(
      `<html>
        <head><title>Structured live report</title></head>
        <body>
          <div id="fusion-app">
            <main>
              <p>The first update contains the opening article paragraph.</p>
              <p>The final update completes the structured live report.</p>
            </main>
          </div>
          <script id="fusion-metadata">
            window.Fusion=window.Fusion||{};
            Fusion.globalContent=${JSON.stringify(fusionContent)};
            Fusion.globalContentConfig={};
          </script>
        </body>
      </html>`,
      'https://example.com/live/structured-report',
    );

    expect(result.content).toContain('https://cdn.example.com/hero.jpg');
    expect(result.content).toContain('https://cdn.example.com/body.jpg');
    expect(result.content).toContain('The body image caption.');
    expect(result.content).toContain('Example Photographer');
    expect(result.content.indexOf('First update')).toBeLessThan(
      result.content.indexOf('https://cdn.example.com/body.jpg'),
    );
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

  it('removes inline Reader icons while preserving article images and math', () => {
    const result = cleaner.clean(
      `<html>
        <head><title>Pinned article</title></head>
        <body>
          <article>
            <p>This article contains enough explanatory text for extraction.</p>
            <svg width="14" height="20" viewBox="0 0 14 20">
              <title>Pin Icon</title>
              <path d="M13 0V2H12V8L14 11V13H8V20H6V13H0V11L2 8V2H1V0H13Z"></path>
            </svg>
            <p>Pinned</p>
            <img src="/article-photo.jpg" alt="Article photo">
            <math alttext="x = 1"><mi>x</mi><mo>=</mo><mn>1</mn></math>
            <p>The remaining text describes the article image and formula.</p>
          </article>
        </body>
      </html>`,
      'https://example.com/posts/article',
    );

    expect(result.content).toContain('Pinned');
    expect(result.content).not.toContain('Pin Icon');
    expect(result.content).not.toContain('<svg');
    expect(result.content).toContain('article-photo.jpg');
    expect(result.content).toContain('<math');
  });

  it('marks linked author avatars without treating article images as avatars', () => {
    const cleanedHtml = cleaner.cleanStoredHtml(
      `<div class="publisher-author">
        <div>
          <a href="https://example.com/u/kokdemo">
            <img src="https://example.com/avatars/kokdemo.jpg" alt="kokdemo">
          </a>
        </div>
        <div>
          <a href="https://example.com/u/kokdemo"><div><p>kokdemo</p></div></a>
          <p>Author biography</p>
        </div>
      </div>
      <p>
        <img src="https://example.com/article-photo.jpg" alt="Article photo">
      </p>`,
    );

    expect(cleanedHtml).toContain('class="publisher-author reader-author-card"');
    expect(cleanedHtml).toContain('class="reader-author-avatar"');
    expect(cleanedHtml).toContain('class="reader-author-name"');
    expect(cleanedHtml).toContain('class="reader-author-bio"');
    expect(cleanedHtml).toContain(
      '<img src="https://example.com/article-photo.jpg" alt="Article photo">',
    );
    expect(cleanedHtml).not.toContain(
      'alt="Article photo" class="reader-author-avatar"',
    );
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

  it('preserves article images but removes image elements marked as icons', () => {
    const html = [
      '<p>Before</p>',
      '<img src="https://example.com/img.jpg" alt="Photo" />',
      '<img width="24" height="24" src="https://example.com/pin.svg" alt="Pushpin" />',
      '<p>After</p>',
    ].join('');
    const md = converter.convert(html);

    expect(md).toContain('Before');
    expect(md).toContain('After');
    expect(md).toContain('![Photo](https://example.com/img.jpg)');
    expect(md).not.toContain('Pushpin');
    expect(md).not.toContain('pin.svg');
  });

  it('removes decorative icons and emoji while keeping translatable text', () => {
    const html = [
      '<div class="leading-icon" role="img" aria-label="Pushpin">',
      '<svg width="16" height="16"><title>Pushpin icon</title></svg></div>',
      '<p><span aria-hidden="true">📌</span>📌 Pinned</p>',
    ].join('');
    const md = converter.convert(html);

    expect(md).toContain('Pinned');
    expect(md).not.toContain('📌');
    expect(md).not.toContain('Pushpin');
  });

  it('preserves inline Markdown math and MathML formulas', () => {
    const html = [
      '<p>Einstein wrote $E = mc^2$.</p>',
      '<p><math alttext="x = (-b ± √(b² - 4ac)) / 2a">',
      '<mi>x</mi><mo>=</mo><mfrac><mn>1</mn><mn>2</mn></mfrac>',
      '</math></p>',
      '<img width="24" height="24" src="/formula.svg" alt="\\(a² + b² = c²\\)">',
    ].join('');
    const md = converter.convert(html);

    expect(md).toContain('$E = mc^2$');
    expect(md).toContain('$x = (-b ± √(b² - 4ac)) / 2a$');
    expect(md).toContain('\\(a² + b² = c²\\)');
  });

  it('should handle code blocks', () => {
    const html = '<pre><code>const x = 1;</code></pre>';
    const md = converter.convert(html);

    expect(md).toContain('```');
    expect(md).toContain('const x = 1;');
  });
});
