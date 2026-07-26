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

    // Exported Reader annotations use a private marker so publisher-provided
    // <mark> elements keep their existing conversion behavior. Inline HTML is
    // used because CommonMark has no standard highlight syntax.
    this.turndown.addRule('shale-export-highlight', {
      filter: (node: HTMLElement) => (
        node.tagName.toLowerCase() === 'mark'
        && node.hasAttribute('data-shale-export-highlight')
      ),
      replacement: (content: string, node: HTMLElement) => {
        const color = toExportHighlightColor(
          node.getAttribute('data-annotation-color'),
        );
        const annotationId = toPositiveInteger(
          node.getAttribute('data-annotation-id'),
        );
        const annotationAttribute = annotationId === undefined
          ? ''
          : ` data-shale-annotation-id="${annotationId}"`;
        return `<mark data-shale-highlight="${color}"${annotationAttribute}`
          + ` style="background-color: ${EXPORT_HIGHLIGHT_COLORS[color]};">`
          + `${content}</mark>`;
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

const EXPORT_HIGHLIGHT_COLORS = {
  yellow: '#f4d35e',
  green: '#7ed391',
  blue: '#69b5eb',
  pink: '#ec84ab',
} as const;

type ExportHighlightColor = keyof typeof EXPORT_HIGHLIGHT_COLORS;

function toExportHighlightColor(value: string | null): ExportHighlightColor {
  return value !== null && Object.hasOwn(EXPORT_HIGHLIGHT_COLORS, value)
    ? value as ExportHighlightColor
    : 'yellow';
}

function toPositiveInteger(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
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
