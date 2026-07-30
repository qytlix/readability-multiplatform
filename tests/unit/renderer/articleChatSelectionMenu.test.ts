import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('Article Chat selection menu', () => {
  it('opens for a Reader selection and sends its structured context', async () => {
    const dom = new JSDOM(`
      <div id="reader">
        <div data-inline-translation-root>
          <p>The <span id="selection">selected claim</span> has context.</p>
        </div>
      </div>
      <div id="mount"></div>
    `, { pretendToBeVisual: true });
    stubDomGlobals(dom);
    const reader = dom.window.document.querySelector<HTMLElement>('#reader');
    const selected = dom.window.document.querySelector<HTMLElement>('#selection');
    const mount = dom.window.document.querySelector<HTMLElement>('#mount');
    const selection = dom.window.getSelection();
    if (!reader || !selected || !mount || !selection) {
      throw new Error('Missing Article Chat selection menu fixture.');
    }
    const range = dom.window.document.createRange();
    range.selectNodeContents(selected);
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => new dom.window.DOMRect(20, 30, 90, 18),
    });
    selection.addRange(range);

    const [{ createElement, act }, { createRoot }, {
      ArticleChatSelectionMenu,
    }] = await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('../../../src/renderer/features/chat/ArticleChatSelectionMenu'),
    ]);
    const onAskAI = vi.fn();
    const root = createRoot(mount);
    await act(async () => {
      root.render(createElement(ArticleChatSelectionMenu, {
        entryId: 7,
        containerRef: { current: reader },
        onAskAI,
      }));
    });

    await act(async () => {
      reader.dispatchEvent(new dom.window.Event('pointerup', { bubbles: true }));
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    });
    const button = mount.querySelector<HTMLButtonElement>('button');
    expect(button?.textContent).toContain('问问 AI');

    await act(async () => {
      button?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    expect(onAskAI).toHaveBeenCalledWith({
      entryId: 7,
      text: 'selected claim',
      paragraphContext: 'The selected claim has context.',
    });
    expect(mount.querySelector('[role="toolbar"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it('closes the menu when the Reader scrolls', async () => {
    const dom = new JSDOM(`
      <div id="reader">
        <p data-inline-translation-root><span id="selection">claim</span></p>
      </div>
      <div id="mount"></div>
    `, { pretendToBeVisual: true });
    stubDomGlobals(dom);
    const reader = dom.window.document.querySelector<HTMLElement>('#reader');
    const selected = dom.window.document.querySelector<HTMLElement>('#selection');
    const mount = dom.window.document.querySelector<HTMLElement>('#mount');
    const selection = dom.window.getSelection();
    if (!reader || !selected || !mount || !selection) {
      throw new Error('Missing Article Chat scroll fixture.');
    }
    const range = dom.window.document.createRange();
    range.selectNodeContents(selected);
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => new dom.window.DOMRect(20, 30, 50, 18),
    });
    selection.addRange(range);

    const [{ createElement, act }, { createRoot }, {
      ArticleChatSelectionMenu,
    }] = await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('../../../src/renderer/features/chat/ArticleChatSelectionMenu'),
    ]);
    const root = createRoot(mount);
    await act(async () => {
      root.render(createElement(ArticleChatSelectionMenu, {
        entryId: 7,
        containerRef: { current: reader },
        onAskAI: vi.fn(),
      }));
    });
    await act(async () => {
      reader.dispatchEvent(new dom.window.Event('pointerup', { bubbles: true }));
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    });
    expect(mount.querySelector('[role="toolbar"]')).not.toBeNull();

    await act(async () => {
      reader.dispatchEvent(new dom.window.Event('scroll'));
    });
    expect(mount.querySelector('[role="toolbar"]')).toBeNull();

    await act(async () => root.unmount());
  });
});

function stubDomGlobals(dom: JSDOM): void {
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('Element', dom.window.Element);
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
  vi.stubGlobal('Node', dom.window.Node);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
}
