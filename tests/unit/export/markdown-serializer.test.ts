import { describe, expect, it } from 'vitest';
import type { EntryAnnotation } from '../../../src/shared/contracts/annotation.types';
import type { ExportableArticle } from '../../../src/shared/contracts/export.types';
import {
  detectExistingFootnoteNumbers,
  insertFootnoteMarkers,
  serializeFootnotes,
  serializeMultiple,
  serializeSingle,
  type FootnoteDef,
} from '../../../src/main/export/MarkdownSerializer';

// ── Fixtures ─────────────────────────────────────────────────

function makeAnnotation(overrides: Partial<EntryAnnotation> & { selectedText: string }): EntryAnnotation {
  return {
    id: 1,
    entryId: 1,
    startOffset: 0,
    endOffset: overrides.selectedText.length,
    prefixText: '',
    suffixText: '',
    color: 'yellow',
    noteText: '',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── detectExistingFootnoteNumbers ──────────────────────────────

describe('detectExistingFootnoteNumbers()', () => {
  it('returns empty set for empty string', () => {
    expect(detectExistingFootnoteNumbers('')).toEqual(new Set());
  });

  it('returns empty set for text without footnotes', () => {
    expect(detectExistingFootnoteNumbers('plain text')).toEqual(new Set());
  });

  it('detects single footnote number', () => {
    const result = detectExistingFootnoteNumbers('text[^1]');
    expect(result).toEqual(new Set([1]));
  });

  it('detects multiple footnote numbers', () => {
    const result = detectExistingFootnoteNumbers('[^1] text [^5] more [^10]');
    expect(result).toEqual(new Set([1, 5, 10]));
  });

  it('ignores non-numeric footnote names', () => {
    const result = detectExistingFootnoteNumbers('[^custom] text [^1]');
    expect(result).toEqual(new Set([1]));
  });

  it('handles escaped brackets correctly', () => {
    const result = detectExistingFootnoteNumbers('not a [\\^1] footnote [^2]');
    expect(result).toEqual(new Set([2]));
  });
});

// ── insertFootnoteMarkers ─────────────────────────────────────

describe('insertFootnoteMarkers()', () => {
  it('returns original body for empty annotations', () => {
    const result = insertFootnoteMarkers('some body text', []);
    expect(result.modifiedBody).toBe('some body text');
    expect(result.footnotes).toEqual([]);
  });

  it('inserts marker and footnote for single annotation with note', () => {
    const body = 'This is a key finding in the text.';
    const ann = makeAnnotation({
      selectedText: 'key finding',
      noteText: 'Important observation',
    });

    const result = insertFootnoteMarkers(body, [ann]);

    expect(result.modifiedBody).toBe('This is a key finding[^1] in the text.');
    expect(result.footnotes).toHaveLength(1);
    expect(result.footnotes[0]).toMatchObject({
      index: 1,
      selectedText: 'key finding',
      noteText: 'Important observation',
    });
  });

  it('handles pure highlight without noteText', () => {
    const body = 'Highlight this part.';
    const ann = makeAnnotation({
      selectedText: 'this part',
      noteText: '',
    });

    const result = insertFootnoteMarkers(body, [ann]);

    expect(result.modifiedBody).toBe('Highlight this part[^1].');
    expect(result.footnotes[0].noteText).toBeUndefined();
  });

  it('processes multiple annotations in order', () => {
    const body = 'First point and second point.';
    const anns = [
      makeAnnotation({ selectedText: 'First point', startOffset: 0, endOffset: 11 }),
      makeAnnotation({ selectedText: 'second point', startOffset: 16, endOffset: 28, noteText: 'Note on second' }),
    ];

    const result = insertFootnoteMarkers(body, anns);

    expect(result.modifiedBody).toBe('First point[^1] and second point[^2].');
    expect(result.footnotes).toHaveLength(2);
    expect(result.footnotes[0].index).toBe(1);
    expect(result.footnotes[1].index).toBe(2);
    expect(result.footnotes[1].noteText).toBe('Note on second');
  });

  it('degrades gracefully when selectedText is not found', () => {
    const body = 'Some text that does not match.';
    const ann = makeAnnotation({
      selectedText: 'missing text',
      noteText: 'Lost note',
    });

    const result = insertFootnoteMarkers(body, [ann]);

    // Body unchanged
    expect(result.modifiedBody).toBe(body);
    // Footnote still present
    expect(result.footnotes).toHaveLength(1);
    expect(result.footnotes[0].index).toBe(1);
    expect(result.footnotes[0].noteText).toBe('Lost note');
  });

  it('skips annotations with newlines in selectedText', () => {
    const body = 'Some text content here.';
    const ann = makeAnnotation({
      selectedText: 'text\ncontent',
    });

    const result = insertFootnoteMarkers(body, [ann]);

    expect(result.modifiedBody).toBe(body);
    expect(result.footnotes).toHaveLength(1);
  });

  it('uses prefixText to disambiguate when unique', () => {
    const body = 'red fox runs. gray fox sleeps.';
    // "fox" appears twice; use unique prefix "gray " to match the second
    const ann = makeAnnotation({
      selectedText: 'fox',
      prefixText: 'gray ',
      startOffset: 16,
      endOffset: 19,
    });

    const result = insertFootnoteMarkers(body, [ann]);

    expect(result.modifiedBody).toBe('red fox runs. gray fox[^1] sleeps.');
  });

  it('falls back to first match when prefixText also matches multiple', () => {
    const body = 'The quick brown fox. The quick red fox.';
    const ann = makeAnnotation({
      selectedText: 'quick',
      // Both "quick" are preceded by "The " — not uniquely disambiguated
      prefixText: 'The ',
    });

    const result = insertFootnoteMarkers(body, [ann]);

    // Falls back to first occurrence
    expect(result.modifiedBody).toBe('The quick[^1] brown fox. The quick red fox.');
  });

  it('uses suffixText to disambiguate multiple matches', () => {
    const body = 'fox jumps. fox runs.';
    const ann = makeAnnotation({
      selectedText: 'fox',
      suffixText: ' runs',
    });

    const result = insertFootnoteMarkers(body, [ann]);

    expect(result.modifiedBody).toBe('fox jumps. fox[^1] runs.');
  });

  it('falls back to first match when prefixText does not match any context', () => {
    const body = 'same same but different.';
    const ann = makeAnnotation({
      selectedText: 'same',
      // prefixText doesn't match any occurrence's context
      prefixText: 'nonexistent',
    });

    const result = insertFootnoteMarkers(body, [ann]);

    // Falls back to first occurrence
    expect(result.modifiedBody).toBe('same[^1] same but different.');
  });

  it('detects and skips existing footnote numbers', () => {
    const body = 'Body with existing footnote[^3].';
    const ann = makeAnnotation({
      selectedText: 'Body',
    });

    const result = insertFootnoteMarkers(body, [ann]);

    expect(result.modifiedBody).toBe('Body[^4] with existing footnote[^3].');
    expect(result.footnotes[0].index).toBe(4);
  });

  it('assigns sequential numbers starting from max+1', () => {
    const body = 'Start[^5] and middle[^2] end.';
    const anns = [
      makeAnnotation({ selectedText: 'Start', startOffset: 0, endOffset: 5 }),
      makeAnnotation({ selectedText: 'middle', startOffset: 13, endOffset: 19, noteText: 'M' }),
    ];

    const result = insertFootnoteMarkers(body, anns);

    // Existing [^5] and [^2] stay in body; new markers [^6] and [^7] are inserted
    expect(result.modifiedBody).toBe('Start[^6][^5] and middle[^7][^2] end.');
    expect(result.footnotes[0].index).toBe(6);
    expect(result.footnotes[1].index).toBe(7);
  });
});

// ── serializeFootnotes ────────────────────────────────────────

describe('serializeFootnotes()', () => {
  it('returns empty string for empty list', () => {
    expect(serializeFootnotes([])).toBe('');
  });

  it('serializes footnote with noteText', () => {
    const footnotes: FootnoteDef[] = [
      { index: 1, selectedText: 'key finding', noteText: 'Important' },
    ];
    expect(serializeFootnotes(footnotes)).toBe('[^1]: "key finding" — Important');
  });

  it('serializes pure highlight footnote without noteText', () => {
    const footnotes: FootnoteDef[] = [
      { index: 2, selectedText: 'highlighted text' },
    ];
    expect(serializeFootnotes(footnotes)).toBe('[^2]: "highlighted text"');
  });

  it('serializes multiple footnotes', () => {
    const footnotes: FootnoteDef[] = [
      { index: 1, selectedText: 'first', noteText: 'Note 1' },
      { index: 3, selectedText: 'third' },
    ];
    const result = serializeFootnotes(footnotes);
    expect(result).toContain('[^1]: "first" — Note 1');
    expect(result).toContain('[^3]: "third"');
  });

  it('truncates long selectedText', () => {
    const longText = 'A'.repeat(150);
    const footnotes: FootnoteDef[] = [
      { index: 1, selectedText: longText },
    ];
    const result = serializeFootnotes(footnotes);
    // Should be truncated with …
    expect(result).toMatch(/…"$/);
    expect(result.length).toBeLessThan('[^1]: ""'.length + 110);
  });
});

// ── serializeSingle integration ───────────────────────────────

describe('serializeSingle() with annotations', () => {
  const baseArticle: ExportableArticle = {
    entryId: 1,
    feedTitle: 'Test Feed',
    title: 'Test Article',
    author: 'Author',
    publishedAt: '2024-01-01T00:00:00.000Z',
    url: 'https://example.com/article',
    cleanedMarkdown: 'This is a key finding in the text.',
    exportOptions: {
      includeSummary: false,
      includeTranslation: false,
      includeNotes: true,
    },
  };

  it('outputs footnote format when annotations are available', () => {
    const annotations: EntryAnnotation[] = [
      makeAnnotation({ selectedText: 'key finding', noteText: 'Crucial point' }),
    ];

    const article = { ...baseArticle, annotations };
    const result = serializeSingle(article, article.exportOptions);

    expect(result).toContain(
      '<mark data-shale-highlight="yellow" data-shale-annotation-id="1" '
      + 'style="background-color: #f4d35e;">key finding</mark>[^1]',
    );
    expect(result).toContain('[^1]: "key finding" — Crucial point');
    expect(result).not.toContain('> **笔记：**');
  });

  it('outputs footnote format for pure highlights without noteText', () => {
    const annotations: EntryAnnotation[] = [
      makeAnnotation({ selectedText: 'key finding' }),
    ];

    const article = { ...baseArticle, annotations };
    const result = serializeSingle(article, article.exportOptions);

    expect(result).toContain(
      '<mark data-shale-highlight="yellow" data-shale-annotation-id="1" '
      + 'style="background-color: #f4d35e;">key finding</mark>[^1]',
    );
    expect(result).toContain('[^1]: "key finding"');
    expect(result).not.toContain('—');
  });

  it('preserves highlights when note export is disabled', () => {
    const article: ExportableArticle = {
      ...baseArticle,
      annotations: [
        makeAnnotation({
          selectedText: 'key finding',
          color: 'blue',
          noteText: 'Do not export this note',
        }),
      ],
      exportOptions: {
        includeSummary: false,
        includeTranslation: false,
        includeNotes: false,
      },
    };

    const result = serializeSingle(article, article.exportOptions);

    expect(result).toContain(
      '<mark data-shale-highlight="blue" data-shale-annotation-id="1" '
      + 'style="background-color: #69b5eb;">key finding</mark>',
    );
    expect(result).not.toContain('[^1]');
    expect(result).not.toContain('Do not export this note');
  });

  it('preserves a colored highlight that spans multiple HTML text nodes', () => {
    const selectedText = 'this important result';
    const article: ExportableArticle = {
      ...baseArticle,
      cleanedHtml: '<p>Read <strong>this important</strong> result.</p>',
      cleanedMarkdown: 'Read **this important** result.',
      annotations: [
        makeAnnotation({
          selectedText,
          startOffset: 5,
          endOffset: 5 + selectedText.length,
          color: 'green',
        }),
      ],
      exportOptions: {
        includeSummary: false,
        includeTranslation: false,
        includeNotes: false,
      },
    };

    const result = serializeSingle(article, article.exportOptions);

    expect(result.match(/data-shale-highlight="green"/g)).toHaveLength(2);
    expect(result).toContain(
      '<mark data-shale-highlight="green" data-shale-annotation-id="1" '
      + 'style="background-color: #7ed391;">this important</mark>',
    );
    expect(result).toContain(
      '<mark data-shale-highlight="green" data-shale-annotation-id="1" '
      + 'style="background-color: #7ed391;">result</mark>',
    );
  });

  it('outputs old quote format when only notes string is available', () => {
    const article = {
      ...baseArticle,
      annotations: undefined,
      notes: 'Legacy note line\nAnother note',
    };
    const result = serializeSingle(article, article.exportOptions);

    expect(result).toContain('> **笔记：**');
    expect(result).toContain('> - Legacy note line');
    expect(result).toContain('> - Another note');
  });

  it('outputs footnotes when both annotations and notes are available', () => {
    const annotations: EntryAnnotation[] = [
      makeAnnotation({ selectedText: 'key finding', noteText: 'From annotation' }),
    ];

    const article = {
      ...baseArticle,
      annotations,
      notes: 'This legacy notes should be ignored when annotations exist',
    };
    const result = serializeSingle(article, article.exportOptions);

    // Should use footnote format (annotations take priority)
    expect(result).toContain('[^1]: "key finding" — From annotation');
    expect(result).not.toContain('> **笔记：**');
    expect(result).not.toContain('legacy notes');
  });

  it('omits footnotes section when there are no matching annotations', () => {
    const annotations: EntryAnnotation[] = [
      makeAnnotation({ selectedText: 'nonexistent text', noteText: 'Lost' }),
    ];

    const article = { ...baseArticle, annotations };
    const result = serializeSingle(article, article.exportOptions);

    // Body unchanged, footnotes still at end
    expect(result).toContain('This is a key finding in the text');
    expect(result).toContain('[^1]: "nonexistent text" — Lost');
  });

  it('works with summary and translation alongside footnotes', () => {
    const annotations: EntryAnnotation[] = [
      makeAnnotation({ selectedText: 'key finding', noteText: 'Important' }),
    ];
    const article: ExportableArticle = {
      ...baseArticle,
      annotations,
      cleanedHtml: '<p>This is a key finding in the text.</p>',
      summary: 'This is a summary.',
      translationSegments: [
        {
          sourceSegmentId: 'seg-title',
          orderIndex: 0,
          sourceType: 'title',
          sourceHtml: '<h2 class="translation-reader-title">Test Article</h2>',
          sourceText: 'Test Article',
          translatedText: '测试文章',
          translatedHtml: '<h2 class="translation-reader-title">测试文章</h2>',
        },
        {
          sourceSegmentId: 'seg-paragraph',
          orderIndex: 1,
          sourceType: 'paragraph',
          sourceHtml: '<p>This is a key finding in the text.</p>',
          sourceText: 'This is a key finding in the text.',
          translatedText: '这是正文的逐段翻译。',
          translatedHtml: '<p>这是正文的逐段翻译。</p>',
        },
      ],
      exportOptions: {
        includeSummary: true,
        includeTranslation: true,
        includeNotes: true,
      },
    };

    const result = serializeSingle(article, article.exportOptions);

    expect(result).toContain('key finding</mark>[^1]');
    expect(result).toContain('## AI SUMMARY');
    expect(result).toContain('> 测试文章');
    expect(result).toContain('> 这是正文的逐段翻译。');
    expect(result).not.toContain('> **翻译：**');
    expect(result).toContain('[^1]: "key finding" — Important');

    // Reader order: title translation → summary → source paragraph → paragraph translation.
    const titleTranslationIndex = result.indexOf('测试文章');
    const summaryIndex = result.indexOf('AI SUMMARY');
    const bodyIndex = result.indexOf('key finding</mark>[^1]');
    const translationIndex = result.indexOf('这是正文的逐段翻译。');
    const footnoteIndex = result.indexOf('[^1]:');
    expect(summaryIndex).toBeGreaterThan(titleTranslationIndex);
    expect(bodyIndex).toBeGreaterThan(summaryIndex);
    expect(translationIndex).toBeGreaterThan(bodyIndex);
    expect(footnoteIndex).toBeGreaterThan(translationIndex);
  });

  it('quotes every summary line below metadata and before the article body', () => {
    const article: ExportableArticle = {
      ...baseArticle,
      summary: 'First summary line.\n\n- Second summary point',
      exportOptions: {
        includeSummary: true,
        includeTranslation: false,
        includeNotes: false,
      },
    };

    const result = serializeSingle(article, article.exportOptions);

    expect(result).toContain(
      '## AI SUMMARY\n\n> First summary line.\n>\n> - Second summary point',
    );
    expect(result.indexOf('AI SUMMARY')).toBeLessThan(result.indexOf('key finding'));
  });

  it('places every translated Reader block immediately after its source block', () => {
    const article: ExportableArticle = {
      entryId: 2,
      title: 'Bilingual article',
      cleanedHtml: [
        '<h2>First heading</h2>',
        '<p>First paragraph.</p>',
        '<p>Second <strong>paragraph</strong>.</p>',
      ].join(''),
      cleanedMarkdown: [
        '## First heading',
        '',
        'First paragraph.',
        '',
        'Second **paragraph**.',
      ].join('\n'),
      translationSegments: [
        {
          sourceSegmentId: 'heading',
          orderIndex: 0,
          sourceType: 'heading',
          sourceHtml: '<h2>First heading</h2>',
          sourceText: 'First heading',
          translatedText: '第一个标题',
          translatedHtml: '<h2>第一个标题</h2>',
        },
        {
          sourceSegmentId: 'first',
          orderIndex: 1,
          sourceType: 'paragraph',
          sourceHtml: '<p>First paragraph.</p>',
          sourceText: 'First paragraph.',
          translatedText: '第一段。',
          translatedHtml: '<p>第一段。</p>',
        },
        {
          sourceSegmentId: 'second',
          orderIndex: 2,
          sourceType: 'paragraph',
          sourceHtml: '<p>Second <strong>paragraph</strong>.</p>',
          sourceText: 'Second paragraph.',
          translatedText: '第二个段落。',
          translatedHtml: '<p>第二个<strong>段落</strong>。</p>',
        },
      ],
      exportOptions: {
        includeSummary: false,
        includeTranslation: true,
        includeNotes: false,
      },
    };

    const result = serializeSingle(article, article.exportOptions);
    const sourceHeadingIndex = result.indexOf('## First heading');
    const translatedHeadingIndex = result.indexOf('第一个标题');
    const firstSourceIndex = result.indexOf('First paragraph.');
    const firstTranslationIndex = result.indexOf('第一段。');
    const secondSourceIndex = result.indexOf('Second **paragraph**.');
    const secondTranslationIndex = result.indexOf('第二个**段落**。');

    expect(translatedHeadingIndex).toBeGreaterThan(sourceHeadingIndex);
    expect(firstSourceIndex).toBeGreaterThan(translatedHeadingIndex);
    expect(firstTranslationIndex).toBeGreaterThan(firstSourceIndex);
    expect(secondSourceIndex).toBeGreaterThan(firstTranslationIndex);
    expect(secondTranslationIndex).toBeGreaterThan(secondSourceIndex);
    expect(result).toContain('> 第一段。');
    expect(result).toContain('> 第二个**段落**。');
  });

  it('uses the same top-summary and inline-translation structure in multi-article exports', () => {
    const article: ExportableArticle = {
      entryId: 3,
      title: 'Multi export article',
      cleanedHtml: '<p>Source paragraph.</p>',
      cleanedMarkdown: 'Source paragraph.',
      summary: 'Summary first.',
      translationSegments: [{
        sourceSegmentId: 'source',
        orderIndex: 0,
        sourceType: 'paragraph',
        sourceHtml: '<p>Source paragraph.</p>',
        sourceText: 'Source paragraph.',
        translatedText: '逐段翻译。',
        translatedHtml: '<p>逐段翻译。</p>',
      }],
      exportOptions: {
        includeSummary: true,
        includeTranslation: true,
        includeNotes: false,
      },
    };

    const result = serializeMultiple([article]);

    expect(result).toContain('## 1. Multi export article');
    expect(result).toContain('### AI SUMMARY\n\n> Summary first.');
    expect(result.indexOf('AI SUMMARY')).toBeLessThan(result.indexOf('Source paragraph.'));
    expect(result.indexOf('逐段翻译。')).toBeGreaterThan(result.indexOf('Source paragraph.'));
  });

  it('handles empty annotations array gracefully', () => {
    const article = { ...baseArticle, annotations: [] };
    const result = serializeSingle(article, article.exportOptions);

    expect(result).not.toContain('[^');
    expect(result).toContain('This is a key finding in the text.');
  });
});
