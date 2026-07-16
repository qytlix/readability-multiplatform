import { describe, expect, it } from 'vitest';
import { ContentSegmenter, CONTENT_SEGMENTER_VERSION } from '../../src/main/feed/ContentSegmenter';

describe('ContentSegmenter', () => {
  it('builds deterministic Reader blocks and skips paragraphs nested in list items', () => {
    const segmenter = new ContentSegmenter();
    const html = [
      '<p>First   paragraph.</p>',
      '<ul><li>First item <p>Nested detail</p></li><li>Second item</li></ul>',
      '<p>Final paragraph.</p>',
    ].join('');

    const result = segmenter.segment(html);

    expect(result.segmenterVersion).toBe(CONTENT_SEGMENTER_VERSION);
    expect(result.segments).toHaveLength(3);
    expect(result.segments.map((segment) => segment.type)).toEqual(['p', 'ul', 'p']);
    expect(result.segments.map((segment) => segment.orderIndex)).toEqual([0, 1, 2]);
    expect(result.segments[0]?.sourceText).toBe('First paragraph.');
    expect(result.segments[1]?.sourceText).toBe('First item Nested detail Second item');
    expect(result.segments.every((segment) => /^seg_\d+_[a-f0-9]{12}$/.test(segment.id))).toBe(true);
  });

  it('keeps IDs and the source hash stable for equivalent whitespace', () => {
    const segmenter = new ContentSegmenter();
    const first = segmenter.segment('<p>A sentence with  spaces.</p><ol><li>One</li><li>Two</li></ol>');
    const second = segmenter.segment('<p> A sentence with spaces. </p><ol>\n<li>One</li>\n<li>Two</li>\n</ol>');

    expect(second.segments.map((segment) => segment.id)).toEqual(first.segments.map((segment) => segment.id));
    expect(second.sourceContentHash).toBe(first.sourceContentHash);
  });

  it('changes the source hash when a translatable block changes', () => {
    const segmenter = new ContentSegmenter();
    const first = segmenter.segment('<p>Original article.</p>');
    const second = segmenter.segment('<p>Changed article.</p>');

    expect(second.sourceContentHash).not.toBe(first.sourceContentHash);
  });
});
