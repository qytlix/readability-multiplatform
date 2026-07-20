import { describe, expect, it } from 'vitest';
import { TranslationBatchStreamParser } from '../../src/main/ai/provider/TranslationBatchStream';

describe('TranslationBatchStreamParser', () => {
  it('withholds partial output until the complete NDJSON object arrives', () => {
    const parser = new TranslationBatchStreamParser();

    expect(parser.append('{"sourceSegmentId":"seg-1","translatedHtml":"<p>译')).toEqual([]);
    const completed = parser.append('文</p>","appliedTermIds":[]}\n');

    expect(completed).toEqual([{
      sourceSegmentId: 'seg-1',
      translatedHtml: '<p>译文</p>',
      appliedTermIds: [],
    }]);
  });

  it('parses multiple ordered lines split across arbitrary chunks', () => {
    const parser = new TranslationBatchStreamParser();
    const first = parser.append([
      '{"sourceSegmentId":"seg-1","translatedHtml":"<p>一</p>","appliedTermIds":[]}\n',
      '{"sourceSegmentId":"seg-2",',
    ].join(''));
    const second = parser.append('"translatedHtml":"<p>二</p>","appliedTermIds":[]}');

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    expect(parser.finish()).toEqual([expect.objectContaining({ sourceSegmentId: 'seg-2' })]);
  });

  it('accepts pretty-printed objects in a json Markdown fence', () => {
    const parser = new TranslationBatchStreamParser();

    expect(parser.append([
      '```json\n',
      '{\n',
      '  "sourceSegmentId": "seg-1",\n',
      '  "translatedHtml": "<p>译文一</p>",\n',
      '  "appliedTermIds": []\n',
      '}\n',
      '{\n',
      '  "sourceSegmentId": "seg-2",\n',
    ].join(''))).toEqual([{
      sourceSegmentId: 'seg-1',
      translatedHtml: '<p>译文一</p>',
      appliedTermIds: [],
    }]);

    expect(parser.append([
      '  "translatedHtml": "<p>译文二</p>",\n',
      '  "appliedTermIds": []\n',
      '}\n',
      '```',
    ].join(''))).toEqual([{
      sourceSegmentId: 'seg-2',
      translatedHtml: '<p>译文二</p>',
      appliedTermIds: [],
    }]);
    expect(parser.finish()).toEqual([]);
  });

  it('rejects explanatory prose outside Translation objects', () => {
    const parser = new TranslationBatchStreamParser();

    expect(() => parser.append('Here is the translation:\n')).toThrow(
      'The provider returned invalid Translation NDJSON.',
    );
  });
});
