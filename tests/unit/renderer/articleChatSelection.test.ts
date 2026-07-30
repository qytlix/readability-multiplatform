import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getArticleChatSelectionTarget } from '../../../src/renderer/features/chat/articleChatSelection';
import { CHAT_SELECTION_LIMITS } from '../../../src/shared/contracts/chat.types';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Article Chat Reader selections', () => {
  it('captures selected Reader text with its paragraph context', () => {
    const fixture = createSelectionFixture(`
      <div data-inline-translation-root>
        <p id="paragraph">The <span id="selection">related documents</span> were submitted.</p>
      </div>
    `);

    expect(resolveSelection(fixture)).toMatchObject({
      selection: {
        entryId: 42,
        text: 'related documents',
        paragraphContext: 'The related documents were submitted.',
      },
    });
    expect(resolveSelection(fixture)?.selection.segmentId).toBeUndefined();
  });

  it('keeps the source segment identity in bilingual source text', () => {
    const fixture = createSelectionFixture(`
      <article class="translation-bilingual-content">
        <p data-segment-id="segment:source">
          Source <span id="selection">claim</span>
        </p>
      </article>
    `);

    expect(resolveSelection(fixture)?.selection).toEqual({
      entryId: 42,
      text: 'claim',
      paragraphContext: 'Source claim',
      segmentId: 'segment:source',
    });
  });

  it('maps a translated bilingual block back to its source segment', () => {
    const fixture = createSelectionFixture(`
      <article class="translation-bilingual-content">
        <p data-segment-id="segment:translated">Source claim</p>
        <div class="translation-bilingual-target">
          <p>Translated <span id="selection">claim</span></p>
        </div>
      </article>
    `);

    expect(resolveSelection(fixture)?.selection).toEqual({
      entryId: 42,
      text: 'claim',
      paragraphContext: 'Translated claim',
      segmentId: 'segment:translated',
    });
  });

  it('maps translated list content through its containing source item', () => {
    const fixture = createSelectionFixture(`
      <article class="translation-bilingual-content">
        <ul>
          <li data-segment-id="segment:list">
            Source item
            <div class="translation-bilingual-target">
              Translated <span id="selection">item</span>
            </div>
          </li>
        </ul>
      </article>
    `);

    expect(resolveSelection(fixture)?.selection).toMatchObject({
      text: 'item',
      segmentId: 'segment:list',
    });
  });

  it('rejects a selection that crosses Reader content roots', () => {
    const fixture = createDom(`
      <div id="container">
        <div data-inline-translation-root><p id="start">First root</p></div>
        <div data-inline-translation-root><p id="end">Second root</p></div>
      </div>
    `);
    const start = fixture.window.document.querySelector('#start')?.firstChild;
    const end = fixture.window.document.querySelector('#end')?.firstChild;
    const container = fixture.window.document.querySelector<HTMLElement>('#container');
    const selection = fixture.window.getSelection();
    if (!start || !end || !container || !selection) {
      throw new Error('Missing cross-root selection fixture.');
    }
    const range = fixture.window.document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end.textContent?.length ?? 0);
    selection.addRange(range);

    expect(getArticleChatSelectionTarget(selection, container, 42)).toBeNull();
  });

  it('rejects an over-limit selection instead of truncating it', () => {
    const selectedText = 'x'.repeat(CHAT_SELECTION_LIMITS.textCharacters + 1);
    const fixture = createSelectionFixture(`
      <div data-inline-translation-root>
        <p><span id="selection">${selectedText}</span></p>
      </div>
    `);

    expect(resolveSelection(fixture)).toBeNull();
  });
});

function createSelectionFixture(markup: string): JSDOM {
  const fixture = createDom(`<div id="container">${markup}</div>`);
  const selected = fixture.window.document.querySelector<HTMLElement>('#selection');
  const selection = fixture.window.getSelection();
  if (!selected || !selection) throw new Error('Missing selection fixture.');
  const range = fixture.window.document.createRange();
  range.selectNodeContents(selected);
  Object.defineProperty(range, 'getBoundingClientRect', {
    value: () => new fixture.window.DOMRect(20, 30, 80, 18),
  });
  selection.addRange(range);
  return fixture;
}

function resolveSelection(fixture: JSDOM) {
  const container = fixture.window.document.querySelector<HTMLElement>('#container');
  if (!container) throw new Error('Missing Reader container.');
  return getArticleChatSelectionTarget(
    fixture.window.getSelection(),
    container,
    42,
  );
}

function createDom(markup: string): JSDOM {
  const fixture = new JSDOM(markup);
  vi.stubGlobal('Element', fixture.window.Element);
  vi.stubGlobal('HTMLElement', fixture.window.HTMLElement);
  vi.stubGlobal('Node', fixture.window.Node);
  return fixture;
}
