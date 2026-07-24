import { describe, expect, it } from 'vitest';
import { previewTerminologyCsv } from '../../../src/main/ai/terminology/TerminologyCsvParser';

describe('previewTerminologyCsv', () => {
  it('parses UTF-8 RFC 4180 quoting, newlines, and preserve-source rows', () => {
    const preview = previewTerminologyCsv('My library', [
      'source,target,tgt_lng',
      '"term, with comma","译文，含逗号",zh-CN',
      '"multi',
      'line","multi',
      'line target",en',
      'Shale,,',
    ].join('\r\n'));

    expect(preview.valid).toBe(true);
    expect(preview.entries).toEqual([
      expect.objectContaining({
        line: 2,
        source: 'term, with comma',
        target: '译文，含逗号',
        targetLanguage: 'zh-CN',
      }),
      expect.objectContaining({
        line: 3,
        source: 'multi\r\nline',
        target: 'multi\r\nline target',
        targetLanguage: 'en',
      }),
      expect.objectContaining({ source: 'Shale' }),
    ]);
  });

  it('reports strict header, quoting, source, language, and field errors by line', () => {
    expect(previewTerminologyCsv('Test', 'target,source,tgt_lng\na,b,en'))
      .toMatchObject({
        valid: false,
        errors: [expect.objectContaining({ code: 'INVALID_HEADER', line: 1 })],
      });
    expect(previewTerminologyCsv(
      'Test',
      'source,target,tgt_lng\n"unclosed,value,en',
    )).toMatchObject({
      valid: false,
      errors: [expect.objectContaining({ code: 'MALFORMED_CSV', line: 2 })],
    });
    expect(previewTerminologyCsv(
      'Test',
      'source,target,tgt_lng\n,value,en\nterm,value,zh-TW',
    )).toMatchObject({
      valid: false,
      errors: [
        expect.objectContaining({ code: 'EMPTY_SOURCE', line: 2 }),
        expect.objectContaining({
          code: 'INVALID_TARGET_LANGUAGE',
          line: 3,
        }),
      ],
    });
  });

  it('warns on duplicates and conflicts and deterministically keeps the first', () => {
    const preview = previewTerminologyCsv('Test', [
      'source,target,tgt_lng',
      'Term,First,en',
      'term,First,en',
      'TERM,Second,en',
    ].join('\n'));

    expect(preview).toMatchObject({
      valid: true,
      acceptedRowCount: 1,
      warnings: [
        expect.objectContaining({ code: 'DUPLICATE', line: 3 }),
        expect.objectContaining({ code: 'CONFLICT', line: 4 }),
      ],
    });
    expect(preview.entries[0]?.target).toBe('First');
  });
});
