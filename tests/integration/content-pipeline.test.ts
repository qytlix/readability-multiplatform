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

  it('sanitizes short feed entry HTML without Readability heuristics', () => {
    const result = cleaner.cleanFeedContent(
      `<p onclick="steal()">Publisher-provided fallback text.</p>
       <script>steal()</script>
       <a href="javascript:steal()">unsafe link</a>`,
      'https://example.com/posts/linked-item',
      'Linked item',
      'Feed author',
    );

    expect(result.title).toBe('Linked item');
    expect(result.content).toContain('Publisher-provided fallback text.');
    expect(result.content).not.toContain('<script');
    expect(result.content).not.toContain('onclick');
    expect(result.content).not.toContain('javascript:');
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

  it('removes linked author cards while preserving article images', () => {
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

    // Author card should be removed entirely
    expect(cleanedHtml).not.toContain('kokdemo');
    expect(cleanedHtml).not.toContain('Author biography');
    expect(cleanedHtml).not.toContain('avatars/kokdemo.jpg');
    // Article image should be preserved
    expect(cleanedHtml).toContain(
      '<img src="https://example.com/article-photo.jpg" alt="Article photo">',
    );
  });

  it('removes author card from The Verge-like full-article HTML', () => {
    const articleParagraph = (
      'As previously reported, the company faced numerous challenges during this period. '
    ).repeat(12);
    const result = cleaner.clean(
      `<html>
        <head><title>Article with author card</title></head>
        <body>
          <article>
            <div class="author-profile">
              <a href="/authors/emma-roth">
                <img
                  src="https://example.com/avatars/emma.jpg"
                  alt="Emma Roth"
                >
              </a>
              <a href="/authors/emma-roth">Emma Roth</a>
              <p>is a news writer who covers the streaming wars, consumer tech, and more.</p>
            </div>
            <p>${articleParagraph}</p>
            <p>${articleParagraph}</p>
          </article>
        </body>
      </html>`,
      'https://example.com/articles/ebay-settlement',
    );

    // Author card must be removed
    expect(result.content).not.toContain('Emma Roth');
    expect(result.content).not.toContain('streaming wars');
    expect(result.content).not.toContain('avatars/emma.jpg');
    // Article text must be preserved
    expect(result.content).toContain('As previously reported');
  });

  it('removes author card with non-link name element (Verge pattern)', () => {
    const articleParagraph = (
      'eBay and three former executives will pay $55.7 million as part of a settlement with a Massachusetts couple. '
    ).repeat(8);
    // The Verge page includes <meta name="author"> which Readability uses
    // to detect the byline even after the small avatar image is stripped.
    const result = cleaner.clean(
      `<html>
        <head>
          <meta name="author" content="Emma Roth">
          <title>Article with Verge-style author card</title>
        </head>
        <body>
          <article>
            <p>
              <a href="/authors/emma-roth">
                <img
                  src="https://example.com/avatars/emma.jpg"
                  alt="Emma Roth"
                  width="36"
                  height="36"
                >
              </a>
              <span>Emma Roth</span>
              <span>is a news writer who covers the streaming wars, consumer tech, crypto, social media, and much more. Previously, she was a writer and editor at MUO.</span>
            </p>
            <p>${articleParagraph}</p>
            <p>${articleParagraph}</p>
          </article>
        </body>
      </html>`,
      'https://www.theverge.com/tech/972209/ebay-cyberstalking-harassment-settlement',
    );

    // Author card must be removed
    expect(result.content).not.toContain('Emma Roth');
    expect(result.content).not.toContain('streaming wars');
    expect(result.content).not.toContain('avatars/emma.jpg');
    // Article text must be preserved
    expect(result.content).toContain('eBay and three former executives');
    expect(result.content).toContain('Massachusetts couple');
  });

  it('removes comment container from cleaned content', () => {
    const articleParagraph = (
      'This article contains the latest reporting on the topic. '
    ).repeat(12);
    const result = cleaner.clean(
      `<html>
        <head><title>Article with comments</title></head>
        <body>
          <article>
            <p>${articleParagraph}</p>
            <p>${articleParagraph}</p>
          </article>
          <section id="comments">
            <h2>Reader comments</h2>
            <div class="comment">
              <img src="https://example.com/avatars/user.jpg" alt="User avatar">
              <p>Great article!</p>
            </div>
          </section>
        </body>
      </html>`,
      'https://example.com/articles/with-comments',
    );

    // Comment section must be removed
    expect(result.content).not.toContain('Reader comments');
    expect(result.content).not.toContain('Great article!');
    // Article text must be preserved
    expect(result.content).toContain('latest reporting');
  });

  it('does not remove inline textual references to comments', () => {
    const articleParagraph = (
      'The article discusses the topic and readers have left comments below. '
    ).repeat(12);
    const result = cleaner.clean(
      `<html>
        <head><title>Article mentioning comments</title></head>
        <body>
          <article>
            <p>${articleParagraph}</p>
            <p>As one commenter noted, this is an important development.</p>
          </article>
        </body>
      </html>`,
      'https://example.com/articles/with-comment-text',
    );

    // Inline text referencing comments must be preserved
    expect(result.content).toContain('As one commenter noted');
    expect(result.content).toContain('have left comments below');
  });

  it('removes Follow topics and authors CTA', () => {
    const articleParagraph = (
      'This article contains enough reporting and analysis for reader extraction. '
    ).repeat(12);
    const result = cleaner.clean(
      `<html>
        <head><title>Article with follow CTA</title></head>
        <body>
          <article>
            <p>${articleParagraph}</p>
            <p>${articleParagraph}</p>
            <p><strong>Follow topics and authors</strong> from this story to see more like this in your personalized homepage feed and to receive email updates.</p>
            <ul>
              <li>Emma Roth</li>
            </ul>
          </article>
        </body>
      </html>`,
      'https://example.com/articles/follow-cta',
    );

    // Follow CTA and its list must be removed
    expect(result.content).not.toContain('Follow topics and authors');
    expect(result.content).not.toContain('personalized homepage feed');
    // Article text must be preserved
    expect(result.content).toContain('enough reporting');
  });

  it('preserves meaningful figures near comment containers', () => {
    const articleParagraph = (
      'The article contains verified reporting, background, and analysis. '
    ).repeat(12);
    const result = cleaner.clean(
      `<html>
        <head><title>Article with figure near comments</title></head>
        <body>
          <article>
            <p>${articleParagraph}</p>
            <figure>
              <img
                src="https://example.com/hero.jpg"
                alt="Chart showing the trend"
                width="800"
                height="600"
              >
              <figcaption>Figure 1: Trend analysis.</figcaption>
            </figure>
            <p>${articleParagraph}</p>
          </article>
        </body>
      </html>`,
      'https://example.com/articles/with-figure',
    );

    expect(result.content).toContain(
      'src="https://example.com/hero.jpg"',
    );
    expect(result.content).toContain('Trend analysis');
    expect(result.content).toContain('Chart showing the trend');
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
