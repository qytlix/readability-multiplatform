import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findHoveredTranslationBlock,
  getParagraphTranslationTarget,
  getSelectionTranslationTarget,
  getShortcutTranslationTarget,
  hasInlineDictionaryDetails,
  InlineTranslationOverlay,
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

  it('does not render an empty dictionary section for sentences', () => {
    expect(hasInlineDictionaryDetails({
      kind: 'paragraph',
      inputKind: 'sentence',
      sourceText: 'A complete sentence.',
      sourceLanguage: 'en',
      detectedSourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      translation: '一个完整的句子。',
      senses: [],
    })).toBe(false);
    expect(hasInlineDictionaryDetails({
      kind: 'selection',
      inputKind: 'word',
      sourceText: 'bank',
      sourceLanguage: 'auto',
      detectedSourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      translation: '银行',
      pronunciation: '/bæŋk/',
      pronunciationSystem: 'ipa',
      senses: [{
        partOfSpeech: 'noun',
        definitions: ['a financial institution'],
        contextualMeaning: 'the lender in this paragraph',
        examples: [],
      }],
    })).toBe(true);
  });

  it('cancels pending provider work when the Reader selection changes', async () => {
    const dom = createReaderDom();
    const container = dom.window.document.querySelector<HTMLElement>('#reader');
    const word = dom.window.document.querySelector<HTMLElement>('#word');
    const selection = dom.window.getSelection();
    if (!container || !word || !selection) throw new Error('Missing Reader fixture.');
    const translateInline = vi.fn(() => new Promise(() => undefined));
    const cancelInline = vi.fn(() => Promise.resolve({
      ok: true as const,
      data: { cancelled: true },
    }));
    Object.defineProperty(dom.window, 'shaleAPI', {
      configurable: true,
      value: {
        translation: {
          translateInline,
          cancelInline,
        },
      },
    });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const [{ createElement, act }, { createRoot }] = await Promise.all([
      import('react'),
      import('react-dom/client'),
    ]);
    const mount = dom.window.document.createElement('div');
    dom.window.document.body.append(mount);
    const root = createRoot(mount);
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

    await act(async () => {
      root.render(createElement(InlineTranslationOverlay, {
        containerRef: { current: container },
        paragraphShortcut,
        selectionShortcut,
        sourceLanguage: 'auto',
        targetLanguage: 'zh-CN',
        useTerminology: true,
        expertId: 'none',
      }));
    });
    const range = dom.window.document.createRange();
    range.selectNodeContents(word);
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => new dom.window.DOMRect(20, 30, 50, 18),
    });
    selection.addRange(range);

    await act(async () => {
      dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        altKey: true,
        bubbles: true,
      }));
    });
    expect(translateInline).toHaveBeenCalledOnce();

    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event('selectionchange'));
    });
    expect(cancelInline).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });
});
