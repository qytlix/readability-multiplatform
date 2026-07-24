import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findHoveredTranslationBlock,
  getParagraphTranslationTarget,
  getSelectionTranslationTarget,
  getShortcutTranslationTarget,
  updateParagraphTranslation,
} from '../../src/renderer/features/translation/InlineTranslationOverlay';

function createReaderDom() {
  const dom = new JSDOM(`
    <div id="reader">
      <div class="entry-detail-html" data-inline-translation-root>
        <p id="paragraph">The <span id="word">related</span> documents were submitted together.</p>
      </div>
    </div>
  `);
  vi.stubGlobal('Element', dom.window.Element);
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
  vi.stubGlobal('Node', dom.window.Node);
  return dom;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('inline Translation Reader targets', () => {
  it('resolves the paragraph currently under the pointer', () => {
    const dom = createReaderDom();
    const container = dom.window.document.querySelector<HTMLElement>('#reader');
    const word = dom.window.document.querySelector<HTMLElement>('#word');
    if (!container || !word) throw new Error('Missing Reader fixture.');

    const block = findHoveredTranslationBlock(word, container);
    expect(block?.id).toBe('paragraph');
    expect(getParagraphTranslationTarget(block, container)).toMatchObject({
      kind: 'paragraph',
      sourceText: 'The related documents were submitted together.',
    });
  });

  it('uses the explicit Reader translation boundary instead of presentation classes', () => {
    const dom = new JSDOM(`
      <div id="reader">
        <article data-inline-translation-root>
          <p id="paragraph"><span id="word">A paragraph in the redesigned Reader.</span></p>
        </article>
      </div>
    `);
    vi.stubGlobal('Element', dom.window.Element);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Node', dom.window.Node);
    const container = dom.window.document.querySelector<HTMLElement>('#reader');
    const word = dom.window.document.querySelector<HTMLElement>('#word');
    if (!container || !word) throw new Error('Missing redesigned Reader fixture.');

    expect(findHoveredTranslationBlock(word, container)?.id).toBe('paragraph');
  });

  it('prefers the selected text and includes its paragraph as context', () => {
    const dom = createReaderDom();
    const container = dom.window.document.querySelector<HTMLElement>('#reader');
    const word = dom.window.document.querySelector<HTMLElement>('#word');
    const selection = dom.window.getSelection();
    if (!container || !word || !selection) throw new Error('Missing Reader fixture.');
    const range = dom.window.document.createRange();
    range.selectNodeContents(word);
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => new dom.window.DOMRect(20, 30, 50, 18),
    });
    selection.addRange(range);

    expect(getSelectionTranslationTarget(selection, container)).toMatchObject({
      kind: 'selection',
      sourceText: 'related',
      context: 'The related documents were submitted together.',
    });
  });

  it('keeps selection and paragraph shortcuts independent', () => {
    const dom = createReaderDom();
    const container = dom.window.document.querySelector<HTMLElement>('#reader');
    const paragraph = dom.window.document.querySelector<HTMLElement>('#paragraph');
    const word = dom.window.document.querySelector<HTMLElement>('#word');
    const selection = dom.window.getSelection();
    if (!container || !paragraph || !word || !selection) {
      throw new Error('Missing Reader fixture.');
    }
    const range = dom.window.document.createRange();
    range.selectNodeContents(word);
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => new dom.window.DOMRect(20, 30, 50, 18),
    });
    selection.addRange(range);
    const selectionShortcut = {
      key: 'S',
      ctrlKey: true,
      altKey: true,
      shiftKey: false,
      metaKey: false,
    };
    const paragraphShortcut = {
      key: 'Z',
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    };

    expect(getShortcutTranslationTarget(
      { ...selectionShortcut, key: 's' },
      selectionShortcut,
      paragraphShortcut,
      selection,
      paragraph,
      container,
    )).toMatchObject({ kind: 'selection', sourceText: 'related' });
    expect(getShortcutTranslationTarget(
      { ...paragraphShortcut, key: 'z' },
      selectionShortcut,
      paragraphShortcut,
      selection,
      paragraph,
      container,
    )).toMatchObject({
      kind: 'paragraph',
      sourceText: 'The related documents were submitted together.',
    });
  });

  it('inserts and updates the translation directly below a paragraph', () => {
    const dom = createReaderDom();
    const paragraph = dom.window.document.querySelector<HTMLElement>('#paragraph');
    if (!paragraph) throw new Error('Missing Reader fixture.');
    const outputs = new Map<HTMLElement, HTMLElement>();

    const loading = updateParagraphTranslation(
      outputs,
      paragraph,
      'loading',
      'Translating...',
    );

    expect(paragraph.nextElementSibling).toBe(loading);
    expect(loading.className).toContain('translation-bilingual-target');
    expect(loading.className).toContain('inline-paragraph-translation');
    expect(loading.textContent).toBe('Translating...');

    const completed = updateParagraphTranslation(
      outputs,
      paragraph,
      'success',
      '这是段落翻译。',
    );

    expect(completed).toBe(loading);
    expect(completed.className).toContain('is-success');
    expect(completed.textContent).toBe('这是段落翻译。');
  });
});
