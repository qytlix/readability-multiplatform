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

  it('places each list-item translation directly below its source item', () => {
    const dom = new JSDOM('<ul><li>First point.</li><li>Second point.</li></ul>');
    const root = dom.window.document.createElement('div');
    root.innerHTML = dom.window.document.body.innerHTML;

    projectBilingualBody(root, [
      segment('first', 0, 'list', '<li>First point.</li>', 'First point.', '<li>First translated.</li>'),
      segment('second', 1, 'list', '<li>Second point.</li>', 'Second point.', '<li>Second translated.</li>'),
    ], {
      showPendingIndicators: false,
    });

    const items = root.querySelectorAll<HTMLElement>(':scope > ul > li');
    expect(items).toHaveLength(2);
    expect(items[0]?.dataset.segmentId).toBe('first');
    expect(items[0]?.querySelector('.translation-bilingual-target')?.textContent)
      .toBe('First translated.');
    expect(items[1]?.dataset.segmentId).toBe('second');
    expect(items[1]?.querySelector('.translation-bilingual-target')?.textContent)
      .toBe('Second translated.');
  });

  it('places each quoted paragraph translation below its source block', () => {
    const dom = new JSDOM(
      '<blockquote><p>Original quote.</p><cite>Quoted author</cite></blockquote>',
    );
    const root = dom.window.document.createElement('div');
    root.innerHTML = dom.window.document.body.innerHTML;

    projectBilingualBody(root, [
      segment(
        'quote',
        0,
        'blockquote',
        '<p>Original quote.</p>',
        'Original quote.',
        '<p>Translated quote.</p>',
      ),
      segment(
        'cite',
        1,
        'blockquote',
        '<cite>Quoted author</cite>',
        'Quoted author',
        '<cite>Translated author</cite>',
      ),
    ], {
      showPendingIndicators: false,
    });

    const quote = root.querySelector('blockquote');
    expect(quote?.children).toHaveLength(4);
    expect(quote?.children[0]?.textContent).toBe('Original quote.');
    expect(quote?.children[1]?.textContent).toBe('Translated quote.');
    expect(quote?.children[2]?.textContent).toBe('Quoted author');
    expect(quote?.children[3]?.textContent).toBe('Translated author');
  });

  it('places a translated prose pre block in a matching framed block below the source', () => {
    const dom = new JSDOM('<pre>Original prose.\n\nSecond paragraph.</pre>');
    const root = dom.window.document.createElement('div');
    root.innerHTML = dom.window.document.body.innerHTML;

    projectBilingualBody(root, [segment(
      'prose-pre',
      0,
      'preformatted',
      '<pre>Original prose.\n\nSecond paragraph.</pre>',
      'Original prose. Second paragraph.',
      '<pre>译文正文。\n\n第二段。</pre>',
    )], {
      showPendingIndicators: false,
    });

    const source = root.querySelector('pre[data-segment-id="prose-pre"]');
    const target = source?.nextElementSibling;
    expect(source?.textContent).toContain('Original prose.');
    expect(target?.classList.contains('translation-segment-preformatted')).toBe(true);
    expect(target?.querySelector('pre')?.textContent).toBe('译文正文。\n\n第二段。');
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
        sourceSegmentId: 'first-list-item',
        orderIndex: 2,
        sourceType: 'list',
        sourceHtml: '<li>First item</li>',
        sourceText: 'First item',
        terminologyMatches: [],
        status: 'pending',
      },
      {
        sourceSegmentId: 'last-list-item',
        orderIndex: 3,
        sourceType: 'list',
        sourceHtml: '<li>Last item</li>',
        sourceText: 'Last item',
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
    expect(root.querySelector('ul > li:first-child')?.lastElementChild?.className)
      .toBe('translation-segment-spinner');
    expect(root.querySelector('ul > li:last-child')?.lastElementChild?.className)
      .toBe('translation-segment-spinner');
    expect(root.querySelector('ul > .translation-segment-spinner')).toBeNull();
  });

  it('shows a failed segment as untranslated instead of leaving its spinner visible', () => {
    const dom = new JSDOM('<p>Special segment.</p><p>Pending paragraph.</p>');
    const root = dom.window.document.createElement('div');
    root.innerHTML = dom.window.document.body.innerHTML;
    const failedSegment: TranslationSegment = {
      sourceSegmentId: 'special',
      orderIndex: 0,
      sourceType: 'paragraph',
      sourceHtml: '<p>Special segment.</p>',
      sourceText: 'Special segment.',
      terminologyMatches: [],
      status: 'failed',
      error: {
        code: 'TRANSLATION_EMPTY_OUTPUT',
        message: 'The provider returned no readable Translation output.',
        retryable: true,
      },
    };
    const pendingSegment: TranslationSegment = {
      sourceSegmentId: 'pending',
      orderIndex: 1,
      sourceType: 'paragraph',
      sourceHtml: '<p>Pending paragraph.</p>',
      sourceText: 'Pending paragraph.',
      terminologyMatches: [],
      status: 'pending',
    };

    projectBilingualBody(root, [failedSegment, pendingSegment], {
      showPendingIndicators: true,
    });

    const untranslated = root.querySelector('.translation-segment-untranslated');
    expect(untranslated?.textContent).toBe('Untranslated');
    expect(untranslated?.getAttribute('role')).toBe('status');
    expect(root.querySelector('[data-segment-id="special"] .translation-segment-spinner')).toBeNull();
    expect(root.querySelector('[data-segment-id="pending"] .translation-segment-spinner')).not.toBeNull();
  });

  it('leaves a locally skipped symbol segment in place without a duplicate target block', () => {
    const dom = new JSDOM('<p>✦ — ✦</p>');
    const root = dom.window.document.createElement('div');
    root.innerHTML = dom.window.document.body.innerHTML;
    const skippedSegment = segment(
      'symbol',
      0,
      'paragraph',
      '<p>✦ — ✦</p>',
      '✦ — ✦',
      '<p>✦ — ✦</p>',
    );

    projectBilingualBody(root, [skippedSegment], {
      showPendingIndicators: false,
    });

    expect(root.querySelector('p')?.textContent).toBe('✦ — ✦');
    expect(root.querySelector('.translation-bilingual-target')).toBeNull();
  });
});
