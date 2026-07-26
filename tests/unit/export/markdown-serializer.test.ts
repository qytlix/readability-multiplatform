import { describe, expect, it } from 'vitest';
import type { EntryAnnotation } from '../../../src/shared/contracts/annotation.types';
import type { ExportableArticle } from '../../../src/shared/contracts/export.types';
import {
  detectExistingFootnoteNumbers,
  insertFootnoteMarkers,
  serializeFootnotes,
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

function makeArticle(overrides: Partial<ExportableArticle> & { cleanedMarkdown: string }): ExportableArticle {
  return {
    entryId: 1,
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

    expect(result).toContain('key finding[^1]');
    expect(result).toContain('[^1]: "key finding" — Crucial point');
    expect(result).not.toContain('> **笔记：**');
  });

  it('outputs footnote format for pure highlights without noteText', () => {
    const annotations: EntryAnnotation[] = [
      makeAnnotation({ selectedText: 'key finding' }),
    ];

    const article = { ...baseArticle, annotations };
    const result = serializeSingle(article, article.exportOptions);

    expect(result).toContain('key finding[^1]');
    expect(result).toContain('[^1]: "key finding"');
    expect(result).not.toContain('—');
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
      summary: 'This is a summary.',
      translation: 'This is a translation.',
      exportOptions: {
        includeSummary: true,
        includeTranslation: true,
        includeNotes: true,
      },
    };

    const result = serializeSingle(article, article.exportOptions);

    expect(result).toContain('key finding[^1]');
    expect(result).toContain('> **AI 摘要：**');
    expect(result).toContain('> **翻译：**');
    expect(result).toContain('[^1]: "key finding" — Important');

    // Verify order: body → summary → translation → footnotes
    const bodyIndex = result.indexOf('key finding[^1]');
    const summaryIndex = result.indexOf('AI 摘要');
    const translationIndex = result.indexOf('翻译');
    const footnoteIndex = result.indexOf('[^1]:');
    expect(footnoteIndex).toBeGreaterThan(translationIndex);
    expect(translationIndex).toBeGreaterThan(summaryIndex);
    expect(summaryIndex).toBeGreaterThan(bodyIndex);
  });

  it('handles empty annotations array gracefully', () => {
    const article = { ...baseArticle, annotations: [] };
    const result = serializeSingle(article, article.exportOptions);

    expect(result).not.toContain('[^');
    expect(result).toContain('This is a key finding in the text.');
  });
});
