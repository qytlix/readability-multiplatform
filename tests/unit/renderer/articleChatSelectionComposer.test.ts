import { JSDOM } from 'jsdom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArticleChatComposer } from '../../../src/renderer/features/chat/ArticleChatComposer';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Article Chat selection composer', () => {
  it('shows only the selected quote and an accessible remove action', () => {
    const html = renderToStaticMarkup(createElement(ArticleChatComposer, {
      ...createComposerProps(),
      selection: {
        entryId: 3,
        text: 'the selected claim',
        paragraphContext: 'Private surrounding paragraph context.',
        segmentId: 'segment:3',
      },
    }));

    expect(html).toContain('引用选区');
    expect(html).toContain('the selected claim');
    expect(html).toContain('aria-label="移除选区引用"');
    expect(html).not.toContain('Private surrounding paragraph context.');
    expect(html).not.toContain('segment:3');
  });

  it('focuses the question textarea for a new Reader selection', async () => {
    const dom = new JSDOM('<div id="mount"></div>', {
      pretendToBeVisual: true,
    });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const mount = dom.window.document.querySelector<HTMLElement>('#mount');
    if (!mount) throw new Error('Missing composer mount.');
    const [{ act }, { createRoot }] = await Promise.all([
      import('react'),
      import('react-dom/client'),
    ]);
    const root = createRoot(mount);

    await act(async () => {
      root.render(createElement(ArticleChatComposer, {
        ...createComposerProps(),
        selection: {
          entryId: 3,
          text: 'claim',
          paragraphContext: 'Paragraph with claim.',
        },
        selectionFocusRequestId: 9,
      }));
    });

    expect(dom.window.document.activeElement).toBe(
      mount.querySelector('textarea'),
    );
    await act(async () => root.unmount());
  });
});

function createComposerProps() {
  return {
    entryId: 3,
    value: '',
    running: false,
    busy: false,
    disabled: false,
    errorMessage: '',
    attachments: [],
    onChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    onRemoveSelection: vi.fn(),
    onPickAttachments: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onPasteImages: vi.fn(),
  };
}
