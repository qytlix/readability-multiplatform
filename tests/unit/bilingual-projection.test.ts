import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { TranslationSegment } from '../../src/shared/contracts/translation.types';
import { projectBilingualBody } from '../../src/renderer/features/translation/bilingualProjection';

function segment(
  sourceSegmentId: string,
  orderIndex: number,
  sourceType: TranslationSegment['sourceType'],
  sourceHtml: string,
  sourceText: string,
  translatedHtml: string,
): TranslationSegment {
  return {
    sourceSegmentId,
    orderIndex,
    sourceType,
    sourceHtml,
    sourceText,
    translatedHtml,
    translatedText: new JSDOM(translatedHtml).window.document.body.textContent ?? '',
    terminologyMatches: [],
    status: 'succeeded',
  };
}

describe('projectBilingualBody', () => {
  it('preserves Reader images and other non-translatable blocks in their original order', () => {
    const dom = new JSDOM([
      '<main>',
      '<p>Before image.</p>',
      '<figure><img src="figure.png" alt="Diagram"><figcaption>System diagram</figcaption></figure>',
      '<img src="standalone.png" alt="Standalone image">',
      '<pre><code>const untouched = true;</code></pre>',
      '<p>After image.</p>',
      '</main>',
    ].join(''));
    const root = dom.window.document.createElement('div');
    root.innerHTML = dom.window.document.body.innerHTML;
    const segments = [
      segment('before', 0, 'paragraph', '<p>Before image.</p>', 'Before image.', '<p>图片之前。</p>'),
      segment('caption', 1, 'caption', '<figcaption>System diagram</figcaption>', 'System diagram', '<figcaption>系统图</figcaption>'),
      segment('after', 2, 'paragraph', '<p>After image.</p>', 'After image.', '<p>图片之后。</p>'),
    ];

    projectBilingualBody(root, segments, {
      showPendingIndicators: false,
    });

    expect(root.querySelectorAll('img')).toHaveLength(2);
    expect(root.querySelector('img[src="figure.png"]')?.closest('figure')).not.toBeNull();
    expect(root.querySelector('pre')?.textContent).toContain('const untouched = true;');
    expect(root.querySelector('[data-segment-id="caption"]')?.tagName).toBe('FIGCAPTION');
    expect(root.querySelector('[data-segment-id="caption"]')?.nextElementSibling?.textContent)
      .toBe('系统图');
    expect(Array.from(root.querySelectorAll('p')).map((element) => element.textContent)).toEqual([
      'Before image.',
      '图片之前。',
      'After image.',
      '图片之后。',
    ]);
  });

  it('keeps an inline image only in the source block while adding translated text', () => {
    const dom = new JSDOM('<p>Read <img src="inline.png" alt="logo"> this.</p>');
    const root = dom.window.document.createElement('div');
    root.innerHTML = dom.window.document.body.innerHTML;

    projectBilingualBody(root, [segment(
      'inline',
      0,
      'paragraph',
      '<p>Read <img src="inline.png" alt="logo"> this.</p>',
      'Read this.',
      '<p>阅读 <img src="inline.png" alt="logo"> 此内容。</p>',
    )], {
      showPendingIndicators: false,
    });

    expect(root.querySelectorAll('img')).toHaveLength(1);
    expect(root.querySelector('.translation-bilingual-target')?.textContent).toBe('阅读  此内容。');
  });

  it('keeps pending paragraphs in place and adds only an end spinner', () => {
    const dom = new JSDOM([
      '<img src="safe.png">',
      '<h2>Pending heading.</h2>',
      '<p>Pending paragraph.</p>',
      '<ul><li>First item</li><li>Last item</li></ul>',
    ].join(''));
    const root = dom.window.document.createElement('div');
    root.innerHTML = dom.window.document.body.innerHTML;
    const pendingSegments: TranslationSegment[] = [
      {
        sourceSegmentId: 'heading',
        orderIndex: 0,
        sourceType: 'heading',
        sourceHtml: '<h2>Pending heading.</h2>',
        sourceText: 'Pending heading.',
        terminologyMatches: [],
        status: 'pending',
      },
      {
        sourceSegmentId: 'paragraph',
        orderIndex: 1,
        sourceType: 'paragraph',
        sourceHtml: '<p>Pending paragraph.</p>',
        sourceText: 'Pending paragraph.',
        terminologyMatches: [],
        status: 'pending',
      },
      {
        sourceSegmentId: 'list',
        orderIndex: 2,
        sourceType: 'list',
        sourceHtml: '<ul><li>First item</li><li>Last item</li></ul>',
        sourceText: 'First item Last item',
        terminologyMatches: [],
        status: 'pending',
      },
    ];

    projectBilingualBody(root, pendingSegments, {
      showPendingIndicators: true,
    });

    expect(root.querySelectorAll('img')).toHaveLength(1);
    expect(root.querySelectorAll('.translation-bilingual-target')).toHaveLength(0);
    expect(root.textContent).not.toContain('Translating');
    expect(root.querySelector('h2')?.lastElementChild?.className)
      .toBe('translation-segment-spinner');
    expect(root.querySelector('p')?.lastElementChild?.className)
      .toBe('translation-segment-spinner');
    expect(root.querySelector('ul > li:last-child')?.lastElementChild?.className)
      .toBe('translation-segment-spinner');
    expect(root.querySelector('ul > .translation-segment-spinner')).toBeNull();
  });
});
