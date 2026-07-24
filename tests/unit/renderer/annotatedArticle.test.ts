import { JSDOM } from 'jsdom';
import {
  act,
  createElement,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnnotatedArticle } from '../../../src/renderer/features/annotations/AnnotatedArticle';
import type { EntryAnnotation } from '../../../src/shared/contracts/annotation.types';

const baseAnnotation: EntryAnnotation = {
  id: 1,
  entryId: 1,
  startOffset: 0,
  endOffset: 5,
  selectedText: 'Hello',
  prefixText: '',
  suffixText: ' world',
  color: 'yellow',
  noteText: '',
  createdAt: '2026-07-24T00:00:00.000Z',
  updatedAt: '2026-07-24T00:00:00.000Z',
};

let root: Root | null = null;
let dom: JSDOM | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  root = null;
  dom?.window.close();
  dom = null;
  vi.unstubAllGlobals();
});

function setup(initialAnnotations: EntryAnnotation[] = []) {
  dom = new JSDOM(
    '<div id="app"></div><div id="toolbar"></div>',
    { url: 'https://reader.example.test' },
  );
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('Node', dom.window.Node);
  vi.stubGlobal('NodeFilter', dom.window.NodeFilter);
  vi.stubGlobal('Element', dom.window.Element);
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
  vi.stubGlobal('MouseEvent', dom.window.MouseEvent);
  vi.stubGlobal('KeyboardEvent', dom.window.KeyboardEvent);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { value: () => undefined, configurable: true },
    detachEvent: { value: () => undefined, configurable: true },
  });

  const create = vi.fn(async () => ({ ok: true as const, data: baseAnnotation }));
  const remove = vi.fn(async () => ({ ok: true as const, data: undefined }));
  const updateNote = vi.fn(async () => ({
    ok: true as const,
    data: { ...baseAnnotation, noteText: 'Saved note' },
  }));
  Object.defineProperty(dom.window, 'shaleAPI', {
    value: {
      annotation: {
        list: vi.fn(async () => ({ ok: true as const, data: initialAnnotations })),
        create,
        updateNote,
        delete: remove,
      },
    },
  });
  const mount = dom.window.document.querySelector<HTMLElement>('#app');
  const toolbar = dom.window.document.querySelector<HTMLDivElement>('#toolbar');
  if (!mount || !toolbar) throw new Error('Missing annotation component fixture.');
  root = createRoot(mount);
  return { mount, toolbar, create, remove, updateNote };
}

describe('AnnotatedArticle', () => {
  it('chooses a color, creates a highlight, opens its editor, and deletes it', async () => {
    const fixture = setup();
    await act(async () => {
      root?.render(createElement(AnnotatedArticle, {
        entryId: 1,
        sourceHtml: '<p>Hello world</p>',
        toolbarTarget: fixture.toolbar,
        onClick: () => undefined,
      }));
      await Promise.resolve();
    });

    const green = fixture.toolbar.querySelector<HTMLButtonElement>(
      '[aria-label="使用绿色荧光笔"]',
    );
    const article = fixture.mount.querySelector<HTMLElement>('.entry-detail-html');
    if (!green || !article || !dom) {
      throw new Error('Annotation toolbar did not render.');
    }
    const activeDom = dom;
    await act(async () => green.click());
    expect(article.classList.contains('is-annotating')).toBe(true);

    const textNode = article.querySelector('p')?.firstChild;
    if (!textNode) throw new Error('Article text did not render.');
    const selection = dom.window.getSelection();
    const range = dom.window.document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);
    selection?.addRange(range);
    await act(async () => {
      article.dispatchEvent(new activeDom.window.MouseEvent('mouseup', { bubbles: true }));
      await Promise.resolve();
    });

    expect(fixture.create).toHaveBeenCalledWith(expect.objectContaining({
      startOffset: 0,
      endOffset: 5,
      selectedText: 'Hello',
      color: 'green',
    }));
    const mark = fixture.mount.querySelector<HTMLElement>(
      'mark[data-annotation-id="1"]',
    );
    if (!mark) throw new Error('Created highlight did not render.');

    await act(async () => {
      mark.dispatchEvent(new activeDom.window.MouseEvent('contextmenu', {
        bubbles: true,
        clientX: 40,
        clientY: 50,
      }));
    });
    expect(fixture.mount.querySelector('textarea[aria-label="批注内容"]'))
      .not.toBeNull();

    const deleteButton = fixture.mount.querySelector<HTMLButtonElement>(
      '[aria-label="删除批注"]',
    );
    if (!deleteButton) throw new Error('Delete annotation button did not render.');
    await act(async () => {
      deleteButton.click();
      await Promise.resolve();
    });
    expect(fixture.remove).toHaveBeenCalledWith({ annotationId: 1 });
    expect(fixture.mount.querySelector('mark[data-annotation-id="1"]')).toBeNull();
  });

  it('shows a saved note when its highlight is hovered', async () => {
    const fixture = setup([{ ...baseAnnotation, noteText: 'Remember this.' }]);
    await act(async () => {
      root?.render(createElement(AnnotatedArticle, {
        entryId: 1,
        sourceHtml: '<p>Hello world</p>',
        toolbarTarget: fixture.toolbar,
        onClick: () => undefined,
      }));
      await Promise.resolve();
    });

    const mark = fixture.mount.querySelector<HTMLElement>(
      'mark[data-annotation-id="1"]',
    );
    if (!mark || !dom) throw new Error('Persisted highlight did not render.');
    const activeDom = dom;
    const article = fixture.mount.querySelector<HTMLElement>('.entry-detail-html');
    if (!article) throw new Error('Annotated article did not render.');
    Object.defineProperty(mark, 'getBoundingClientRect', {
      value: () => new activeDom.window.DOMRect(220, 180, 60, 18),
    });
    Object.defineProperty(article, 'getBoundingClientRect', {
      value: () => new activeDom.window.DOMRect(100, 60, 500, 600),
    });
    await act(async () => {
      mark.dispatchEvent(new activeDom.window.MouseEvent('mouseover', {
        bubbles: true,
      }));
    });

    const note = fixture.mount.querySelector<HTMLElement>(
      '.annotation-note.is-preview',
    );
    expect(note?.textContent).toContain('Remember this.');
    expect(note?.style.left).toBe('618px');
    expect(note?.style.top).toBe('176px');
    const connector = fixture.mount.querySelector<HTMLElement>(
      '.annotation-note-connector',
    );
    expect(connector?.dataset.annotationColor).toBe('yellow');
    expect(connector?.style.left).toBe('220px');
    expect(connector?.style.top).toBe('180px');
    expect(connector?.style.width).toBe('399px');
    expect(connector?.style.height).toBe('50px');
    expect(connector?.style.clipPath)
      .toBe('polygon(0 0px, 100% 4px, 100% 50px, 0 18px)');
    const timestamp = note?.querySelector('time');
    expect(timestamp?.getAttribute('datetime'))
      .toBe('2026-07-24T00:00:00.000Z');
    expect(timestamp?.textContent)
      .toMatch(/^2026\/7\/24 \d{2}:\d{2}:\d{2}$/);
  });

  it('opens and saves a note outside annotation mode', async () => {
    const fixture = setup([baseAnnotation]);
    await act(async () => {
      root?.render(createElement(AnnotatedArticle, {
        entryId: 1,
        sourceHtml: '<p>Hello world</p>',
        toolbarTarget: fixture.toolbar,
        onClick: () => undefined,
      }));
      await Promise.resolve();
    });

    if (!dom) {
      throw new Error('Persisted annotation controls did not render.');
    }
    const activeDom = dom;
    const mark = fixture.mount.querySelector<HTMLElement>(
      'mark[data-annotation-id="1"]',
    );
    if (!mark) throw new Error('Persisted highlight did not render.');
    await act(async () => {
      mark.dispatchEvent(new activeDom.window.MouseEvent('contextmenu', {
        bubbles: true,
        clientX: 40,
        clientY: 50,
      }));
    });

    const textarea = fixture.mount.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="批注内容"]',
    );
    if (!textarea) throw new Error('Annotation editor did not open.');
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        activeDom.window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, 'My note');
      textarea.dispatchEvent(new activeDom.window.KeyboardEvent('keyup', {
        bubbles: true,
        key: 'e',
      }));
    });
    await act(async () => {
      activeDom.window.document.body.dispatchEvent(
        new activeDom.window.Event('pointerdown', { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(fixture.updateNote).toHaveBeenCalledWith({
      annotationId: 1,
      noteText: 'My note',
    });
    expect(fixture.mount.querySelector('.annotation-note')).toBeNull();
    expect(fixture.mount.querySelector('.annotation-note-connector')).toBeNull();
  });
});
