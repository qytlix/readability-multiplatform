import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/articles');

describe('Readability Content Extraction Prototype', () => {
  let Readability: typeof import('@mozilla/readability').Readability;
  let JSDOM: typeof import('jsdom').JSDOM;

  beforeAll(async () => {
    // Dynamically import to verify module loading in main process context
    const readabilityModule = await import('@mozilla/readability');
    const jsdomModule = await import('jsdom');
    Readability = readabilityModule.Readability;
    JSDOM = jsdomModule.JSDOM;
  });

  function extract(html: string, url: string) {
    const doc = new JSDOM(html, { url });
    const reader = new Readability(doc.window.document);
    const result = reader.parse();
    return result;
  }

  function sanitize(html: string): string {
    // Basic sanitization: remove script tags, event handlers, javascript: URLs
    let cleaned = html;
    // Remove <script>...</script> tags
    cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    // Remove onclick and other event attributes
    cleaned = cleaned.replace(/\s*on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    // Remove javascript: URLs
    cleaned = cleaned.replace(/href\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, 'href="#"');
    cleaned = cleaned.replace(/src\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, 'src="#"');
    return cleaned;
  }

  describe('simple article', () => {
    let result: ReturnType<typeof extract>;

    beforeAll(() => {
      const html = fs.readFileSync(
        path.join(FIXTURES_DIR, 'simple-article.html'),
        'utf-8',
      );
      result = extract(html, 'https://example.com/article');
    });

    it('should extract title from <title> tag', () => {
      expect(result).not.toBeNull();
      // Readability uses the <title> tag value
      expect(result!.title).toBe('Simple Test Article');
    });

    it('should extract byline', () => {
      expect(result!.byline).toContain('Test Author');
    });

    it('should extract content (non-empty HTML)', () => {
      expect(result!.content).toBeDefined();
      expect(result!.content.length).toBeGreaterThan(100);
    });

    it('should extract readable text content', () => {
      const textContent = result!.textContent;
      expect(textContent).toBeDefined();
      // Readability's textContent doesn't include the page title
      expect(textContent!).toContain('first paragraph of a simple test article');
      expect(textContent!).toContain('Section One');
      expect(textContent!).toContain('Section Two');
    });

    it('should exclude script content', () => {
      expect(result!.content).not.toContain('console.log');
      expect(result!.content).not.toContain('malicious');
    });

    it('should exclude nav/footer boilerplate', () => {
      expect(result!.content).not.toContain('Comment section that should be removed');
    });
  });

  describe('complex article with tables, code, and images', () => {
    let result: ReturnType<typeof extract>;

    beforeAll(() => {
      const html = fs.readFileSync(
        path.join(FIXTURES_DIR, 'complex-article.html'),
        'utf-8',
      );
      result = extract(html, 'https://example.com/complex-article');
    });

    it('should extract', () => {
      expect(result).not.toBeNull();
      // Readability uses the <title> tag value
      expect(result!.title).toBe('Complex Article with Tables, Code, and Images');
    });

    it('should preserve table structure', () => {
      expect(result!.content).toContain('Quarter');
      expect(result!.content).toContain('Revenue');
      expect(result!.content).toContain('Growth');
    });

    it('should preserve code blocks', () => {
      expect(result!.content).toContain('fibonacci');
      expect(result!.content).toContain('function fibonacci');
    });

    it('should preserve blockquotes', () => {
      expect(result!.content).toContain('blockquote');
    });

    it('should preserve images', () => {
      expect(result!.content).toContain('<img');
      expect(result!.content).toContain('example.com/image1.jpg');
      expect(result!.content).toContain('figure');
    });

    it('should preserve lists', () => {
      const textContent = result!.textContent;
      expect(textContent!).toContain('Fast parsing');
      expect(textContent!).toContain('Cross-platform');
      expect(textContent!).toContain('Install dependencies');
    });

    it('should exclude sidebar navigation', () => {
      expect(result!.content).not.toContain('id="sidebar"');
    });
  });

  describe('chinese article', () => {
    let result: ReturnType<typeof extract>;

    beforeAll(() => {
      const html = fs.readFileSync(
        path.join(FIXTURES_DIR, 'chinese-article.html'),
        'utf-8',
      );
      result = extract(html, 'https://zh-example.com/article');
    });

    it('should extract Chinese title from <title> tag', () => {
      expect(result).not.toBeNull();
      // Readability uses the <title> content — full title with dash separator
      expect(result!.title).toContain('React');
      expect(result!.title).toContain('构建现代 Web 应用');
    });

    it('should extract Chinese content', () => {
      const textContent = result!.textContent;
      expect(textContent!).toContain('组件化开发');
      expect(textContent!).toContain('虚拟 DOM');
      expect(textContent!).toContain('性能优化建议');
    });

    it('should preserve Chinese code comments', () => {
      expect(result!.content).toContain('通用组件');
      expect(result!.content).toContain('自定义 Hook');
    });

    it('should exclude scripts', () => {
      expect(result!.content).not.toContain('跟踪代码');
      expect(result!.content).not.toContain('console.log');
    });
  });

  describe('sanitization', () => {
    it('should remove script tags', () => {
      const dirty = '<div><script>alert("xss")</script><p>Hello</p></div>';
      const cleaned = sanitize(dirty);
      expect(cleaned).not.toContain('<script');
      expect(cleaned).toContain('<p>Hello</p>');
    });

    it('should remove event handlers', () => {
      const dirty = '<img src="x" onclick="alert(1)" onerror="steal()" />';
      const cleaned = sanitize(dirty);
      expect(cleaned).not.toContain('onclick');
      expect(cleaned).not.toContain('onerror');
    });

    it('should remove javascript: URLs', () => {
      const dirty = '<a href="javascript:alert(1)">click</a>';
      const cleaned = sanitize(dirty);
      expect(cleaned).not.toContain('javascript:alert');
    });
  });
});