import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import {
  isMathElement,
  removeUntranslatableIcons,
  removeVisualEmoji,
} from './ContentGraphics';

export const MARKDOWN_CONVERTER_VERSION = 1;

export class MarkdownConverter {
  private turndown: TurndownService;

  constructor() {
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined',
      preformattedCode: true,
    });

    // Article images remain useful Reader content. Icon-like images are handled
    // by the higher-priority rule below.
    this.turndown.addRule('images', {
      filter: 'img',
      replacement: (content: string, node: HTMLElement) => {
        const img = node as HTMLImageElement;
        const alt = removeVisualEmoji(img.getAttribute('alt') || '');
        const src = img.getAttribute('src') || '';
        return src ? `![${alt}](${src})` : '';
      },
    });

    // Math is the intentional exception to text-only translation input. Prefer
    // an explicit TeX representation when publishers provide one.
    this.turndown.addRule('math', {
      filter: (node: HTMLElement) => isMathElement(node),
      replacement: (content: string, node: HTMLElement) => {
        const formula = extractFormula(node);
        if (!formula) return content;
        if (hasMathDelimiter(formula)) return ` ${formula} `;

        return isDisplayMath(node)
          ? `\n\n$$\n${formula}\n$$\n\n`
          : ` $${formula}$ `;
      },
    });
  }

  convert(html: string): string {
    const dom = new JSDOM(`<body>${html}</body>`);
    const body = dom.window.document.body;
    removeUntranslatableIcons(body);
    return normalizeMarkdown(this.turndown.turndown(body));
  }
}

function extractFormula(node: HTMLElement): string {
  const explicitFormula = node.getAttribute('data-tex')
    ?? node.getAttribute('data-latex')
    ?? node.getAttribute('alttext')
    ?? node.getAttribute('alt')
    ?? node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
  return normalizeFormula(explicitFormula ?? node.textContent ?? '');
}

function normalizeFormula(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hasMathDelimiter(value: string): boolean {
  return (
    (value.startsWith('$') && value.endsWith('$'))
    || (value.startsWith('\\(') && value.endsWith('\\)'))
    || (value.startsWith('\\[') && value.endsWith('\\]'))
  );
}

function isDisplayMath(node: HTMLElement): boolean {
  return node.getAttribute('display')?.toLowerCase() === 'block'
    || node.classList.contains('katex-display')
    || node.classList.contains('math-display');
}

function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
