import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { EntryAnnotation } from '../../../src/shared/contracts/annotation.types';
import {
  applyAnnotationHighlights,
  createAnnotationRequestFromSelection,
  rangesOverlap,
  resolveAnnotationRange,
} from '../../../src/renderer/features/annotations/annotationAnchors';

function annotation(
  override: Partial<EntryAnnotation> = {},
): EntryAnnotation {
  return {
    id: 1,
    entryId: 1,
    startOffset: 4,
    endOffset: 15,
    selectedText: 'quick brown',
    prefixText: 'The ',
    suffixText: ' fox',
    color: 'yellow',
    noteText: '',
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    ...override,
  };
}

describe('annotation text anchors', () => {
  it('serializes a selection spanning nested markup into stable text offsets', () => {
    const dom = new JSDOM(
      '<div id="root"><p>The <strong>quick</strong> brown fox</p></div>',
    );
    const root = dom.window.document.querySelector<HTMLElement>('#root');
    const quick = dom.window.document.querySelector('strong')?.firstChild;
    const paragraphText = root?.querySelector('p')?.lastChild;
    const selection = dom.window.getSelection();
    if (!root || !quick || !paragraphText || !selection) {
      throw new Error('Missing annotation fixture.');
    }
    const range = dom.window.document.createRange();
    range.setStart(quick, 0);
    range.setEnd(paragraphText, 6);
    selection.addRange(range);

    expect(createAnnotationRequestFromSelection(
      selection,
      root,
      9,
      'green',
    )).toMatchObject({
      entryId: 9,
      startOffset: 4,
      endOffset: 15,
      selectedText: 'quick brown',
      prefixText: 'The ',
      suffixText: ' fox',
      color: 'green',
    });
  });

  it('renders a multi-node highlight without replacing existing safe markup', () => {
    const dom = new JSDOM('<body></body>');
    const highlighted = applyAnnotationHighlights(
      '<p>The <strong>quick</strong> brown fox</p>',
      [annotation()],
      dom.window.document,
    );
    const container = dom.window.document.createElement('div');
    container.innerHTML = highlighted;
    const marks = [...container.querySelectorAll('mark[data-annotation-id="1"]')];

    expect(marks.map((mark) => mark.textContent).join('')).toBe('quick brown');
    expect(marks).toHaveLength(2);
    expect(container.querySelector('strong')).not.toBeNull();
    expect(container.textContent).toBe('The quick brown fox');
    expect(marks.every((mark) =>
      mark.getAttribute('data-annotation-color') === 'yellow')).toBe(true);
  });

  it('recovers an anchor from its quote and surrounding context after text shifts', () => {
    const shiftedText = 'Intro. The quick brown fox and the quick brown dog.';
    const recovered = resolveAnnotationRange(
      annotation({
        startOffset: 4,
        endOffset: 15,
        prefixText: 'the ',
        suffixText: ' dog',
      }),
      shiftedText,
    );

    expect(recovered).not.toBeNull();
    expect(
      shiftedText.slice(recovered?.startOffset, recovered?.endOffset),
    ).toBe('quick brown');
    expect(recovered?.startOffset).toBe(35);
  });

  it('treats touching ranges as adjacent and true intersections as overlaps', () => {
    const existing = [annotation()];

    expect(rangesOverlap(0, 4, existing)).toBe(false);
    expect(rangesOverlap(15, 19, existing)).toBe(false);
    expect(rangesOverlap(14, 20, existing)).toBe(true);
    expect(rangesOverlap(6, 9, existing)).toBe(true);
  });
});
