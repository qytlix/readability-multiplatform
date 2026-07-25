import { describe, expect, it } from 'vitest';
import { ContentSegmenter, CONTENT_SEGMENTER_VERSION } from '../../src/main/feed/services/ContentSegmenter';

describe('ContentSegmenter', () => {
  it('builds one deterministic Reader segment per list item', () => {
    const segmenter = new ContentSegmenter();
    const html = [
      '<p>First   paragraph.</p>',
      '<ul><li>First item <p>Nested detail</p></li><li>Second item</li></ul>',
      '<p>Final paragraph.</p>',
    ].join('');

    const result = segmenter.segment(html);

    expect(result.segmenterVersion).toBe(CONTENT_SEGMENTER_VERSION);
    expect(result.segments).toHaveLength(4);
    expect(result.segments.map((segment) => segment.type)).toEqual([
      'paragraph',
      'list',
      'list',
      'paragraph',
    ]);
    expect(result.segments.map((segment) => segment.orderIndex)).toEqual([0, 1, 2, 3]);
    expect(result.segments[0]?.sourceText).toBe('First paragraph.');
    expect(result.segments[1]?.sourceText).toBe('First item Nested detail');
    expect(result.segments[1]?.sourceHtml).toBe(
      '<li>First item<p>Nested detail</p></li>',
    );
    expect(result.segments[2]?.sourceText).toBe('Second item');
    expect(result.segments[2]?.sourceHtml).toBe('<li>Second item</li>');
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

  it('segments Reader metadata and rich block roles without duplicating nested text', () => {
    const segmenter = new ContentSegmenter();
    const result = segmenter.segment([
      '<h1>Reader title</h1>',
      '<h2>Section</h2>',
      '<blockquote><p><strong>Quoted</strong> text.</p><cite>Source</cite></blockquote>',
      '<ul><li><h3>Nested heading</h3>List item</li></ul>',
      '<figure><img src="safe.png" alt=""><figcaption>Figure caption</figcaption></figure>',
    ].join(''), {
      title: 'Reader title',
      byline: 'Ada Author',
    });

    expect(result.segments.map((segment) => segment.type)).toEqual([
      'title',
      'heading',
      'blockquote',
      'blockquote',
      'list',
      'caption',
    ]);
    expect(result.segments.map((segment) => segment.sourceText)).toEqual([
      'Reader title',
      'Section',
      'Quoted text.',
      'Source',
      'Nested heading List item',
      'Figure caption',
    ]);
    expect(result.segments[2]?.sourceHtml).toContain('<strong>Quoted</strong>');
    expect(result.segments.some((segment) => segment.type === 'byline')).toBe(false);
    expect(result.segments.filter((segment) => segment.type === 'heading'))
      .toHaveLength(1);
  });

  it('segments nested list items without duplicating child-list text', () => {
    const segmenter = new ContentSegmenter();
    const result = segmenter.segment([
      '<ul>',
      '<li>Parent point<ul><li>Nested point</li></ul></li>',
      '<li>Sibling point</li>',
      '</ul>',
    ].join(''));

    expect(result.segments.map((segment) => segment.sourceText)).toEqual([
      'Parent point',
      'Nested point',
      'Sibling point',
    ]);
    expect(result.segments.map((segment) => segment.sourceHtml)).toEqual([
      '<li>Parent point</li>',
      '<li>Nested point</li>',
      '<li>Sibling point</li>',
    ]);
  });
});
