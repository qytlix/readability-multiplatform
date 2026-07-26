import { describe, expect, it } from 'vitest';
import {
  markdownExportFilename,
  safeFilename,
} from '../../../src/main/export/safeFilename';
import type { PerArticleOptions } from '../../../src/shared/contracts/export.types';

const noOptionalContent: PerArticleOptions = {
  includeSummary: false,
  includeTranslation: false,
  includeNotes: false,
};

describe('safeFilename', () => {
  it('removes characters that are invalid in Windows filenames', () => {
    expect(safeFilename('Hello: World? | Test')).toBe('Hello World Test');
  });
});

describe('markdownExportFilename', () => {
  it('keeps the original filename when no optional content is selected', () => {
    expect(markdownExportFilename('文章标题', [noOptionalContent]))
      .toBe('文章标题.md');
  });

  it('appends selected content labels in a stable order', () => {
    expect(markdownExportFilename('文章标题', [{
      includeSummary: true,
      includeTranslation: true,
      includeNotes: false,
    }])).toBe('文章标题（翻译、总结）.md');
  });

  it('uses the union of per-article options for a multi-article export', () => {
    expect(markdownExportFilename('文摘-2026-07-26', [
      {
        includeSummary: true,
        includeTranslation: false,
        includeNotes: false,
      },
      {
        includeSummary: false,
        includeTranslation: true,
        includeNotes: true,
      },
    ])).toBe('文摘-2026-07-26（翻译、总结、笔记）.md');
  });

  it('preserves the selected labels when a long title must be truncated', () => {
    const filename = markdownExportFilename('文'.repeat(240), [{
      includeSummary: false,
      includeTranslation: true,
      includeNotes: true,
    }]);

    expect(filename).toHaveLength(203);
    expect(filename.endsWith('（翻译、笔记）.md')).toBe(true);
  });
});
