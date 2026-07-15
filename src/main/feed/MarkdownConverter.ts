import TurndownService from 'turndown';

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

    // Preserve images
    this.turndown.addRule('images', {
      filter: 'img',
      replacement: (content: string, node: HTMLElement) => {
        const img = node as HTMLImageElement;
        const alt = img.getAttribute('alt') || '';
        const src = img.getAttribute('src') || '';
        return src ? `![${alt}](${src})` : '';
      },
    });
  }

  convert(html: string): string {
    return this.turndown.turndown(html);
  }
}