import { describe, expect, it } from 'vitest';
import { parseTranslationOutput } from '../../src/main/ai/provider/TranslationHtml';
import {
  TRANSLATION_HTML_VALIDATION_REASONS,
  TRANSLATION_OUTPUT_REASON_CODES,
  type TranslationHtmlValidationReason,
} from '../../src/main/ai/TranslationOutputDiagnostics';
import { TRANSLATION_ERROR_CODES } from '../../src/shared/errors/translation.errors';

function expectHtmlStructureFailure(
  sourceHtml: string,
  translatedHtml: string,
  htmlValidationReason: TranslationHtmlValidationReason,
): void {
  try {
    parseTranslationOutput(sourceHtml, JSON.stringify({ translatedHtml, appliedTermIds: [] }));
    throw new Error('Expected the HTML structure change to be rejected.');
  } catch (error) {
    expect(error).toMatchObject({
      code: TRANSLATION_ERROR_CODES.TRANSLATION_INVALID_STRUCTURE,
      reasonCode: TRANSLATION_OUTPUT_REASON_CODES.htmlStructureInvalid,
      htmlValidationReason,
    });
  }
}

describe('parseTranslationOutput', () => {
  it('classifies an empty readable segment as empty output', () => {
    try {
      parseTranslationOutput('<p> </p>', JSON.stringify({
        translatedHtml: '<p></p>',
        appliedTermIds: [],
      }));
      throw new Error('Expected the empty translation to be rejected.');
    } catch (error) {
      expect(error).toMatchObject({
        code: TRANSLATION_ERROR_CODES.TRANSLATION_EMPTY_OUTPUT,
        reasonCode: TRANSLATION_OUTPUT_REASON_CODES.translatedHtmlEmpty,
      });
    }
  });

  it('preserves the sanitized Reader structure and records applied local terms', () => {
    const sourceHtml = '<p style="color: #345"><strong>Transformer</strong> models.</p>';
    const output = JSON.stringify({
      translatedHtml: '<p style="color: red"><strong>Transformer</strong> 模型。</p>',
      appliedTermIds: ['agrovoc:concept-1'],
    });

    const result = parseTranslationOutput(sourceHtml, output, [{
      conceptId: 'concept-1',
      sourceId: 'agrovoc',
      sourceTerm: 'Transformer',
      targetTerm: 'Transformer 模型',
    }]);

    expect(result.translatedText).toBe('Transformer 模型。');
    expect(result.translatedHtml).toContain('style="color: #345"');
    expect(result.translatedHtml).toContain('<strong>Transformer</strong>');
    expect(result.terminologyMatches).toHaveLength(1);
  });

  it('accepts an independently translated list-item root', () => {
    const result = parseTranslationOutput(
      '<li><strong>First</strong> point.</li>',
      JSON.stringify({
        translatedHtml: '<li><strong>第一</strong>点。</li>',
        appliedTermIds: [],
      }),
    );

    expect(result.translatedText).toBe('第一点。');
    expect(result.translatedHtml).toBe('<li><strong>第一</strong>点。</li>');
  });

  it('preserves a translated prose pre block and its line breaks', () => {
    const result = parseTranslationOutput(
      '<pre>First paragraph.\n\nSecond paragraph.</pre>',
      JSON.stringify({
        translatedHtml: '<pre>第一段。\n\n第二段。</pre>',
        appliedTermIds: [],
      }),
    );

    expect(result.translatedText).toBe('第一段。 第二段。');
    expect(result.translatedHtml).toBe('<pre>第一段。\n\n第二段。</pre>');
  });

  it('removes model-provided dangerous attributes while retaining source attributes', () => {
    const output = JSON.stringify({
      translatedHtml: '<p onclick="steal()"><a href="javascript:steal()">译文</a></p>',
      appliedTermIds: [],
    });
    const result = parseTranslationOutput(
      '<p class="safe"><a href="https://example.com">Source</a></p>',
      output,
    );

    expect(result.translatedHtml).toContain('class="safe"');
    expect(result.translatedHtml).toContain('href="https://example.com"');
    expect(result.translatedHtml).not.toContain('onclick');
    expect(result.translatedHtml).not.toContain('javascript:');
  });

  it('preserves source attributes with entity and void-element structure intact', () => {
    const result = parseTranslationOutput(
      '<p>Source &amp; <br><img src="https://example.com/source.png" alt="source"></p>',
      JSON.stringify({
        translatedHtml: '<p>译文 &amp; <br><img src="https://example.com/model.png" alt="model"></p>',
        appliedTermIds: [],
      }),
    );

    expect(result.translatedText).toBe('译文 &');
    expect(result.translatedHtml).toContain('src="https://example.com/source.png"');
    expect(result.translatedHtml).toContain('alt="source"');
  });

  it('accepts a parser-canonicalized missing end tag when the resulting DOM is equivalent', () => {
    const result = parseTranslationOutput(
      '<p><strong>Source</strong></p>',
      JSON.stringify({
        translatedHtml: '<p><strong>译文</p>',
        appliedTermIds: [],
      }),
    );

    expect(result.translatedHtml).toBe('<p><strong>译文</strong></p>');
  });

  it('classifies source-safe output without a root element', () => {
    expectHtmlStructureFailure(
      '<p>Source</p>',
      '<script>not-reader-html</script>',
      TRANSLATION_HTML_VALIDATION_REASONS.rootMissing,
    );
  });

  it('classifies multiple root elements', () => {
    expectHtmlStructureFailure(
      '<p>Source</p>',
      '<p>第一段</p><p>第二段</p>',
      TRANSLATION_HTML_VALIDATION_REASONS.multipleRoots,
    );
  });

  it('classifies a provider response that changes the element count', () => {
    expectHtmlStructureFailure(
      '<p><strong>Source</strong></p>',
      '<p><strong>译文</strong><em>额外结构</em></p>',
      TRANSLATION_HTML_VALIDATION_REASONS.elementCountMismatch,
    );
  });

  it('classifies a provider response that changes element tag order', () => {
    expectHtmlStructureFailure(
      '<p><strong>First</strong><em>second</em></p>',
      '<p><em>第一</em><strong>第二</strong></p>',
      TRANSLATION_HTML_VALIDATION_REASONS.elementTagMismatch,
    );
  });

  it('rejects a provider response that reparents an existing element', () => {
    expectHtmlStructureFailure(
      '<p><strong>First</strong><em>second</em></p>',
      '<p><strong>First<em>second</em></strong></p>',
      TRANSLATION_HTML_VALIDATION_REASONS.elementNestingMismatch,
    );
  });

  it('rejects moving translated text outside its original style boundary', () => {
    expectHtmlStructureFailure(
      '<p><a href="https://example.com">Linked source</a></p>',
      '<p><a></a>Translated as plain text</p>',
      TRANSLATION_HTML_VALIDATION_REASONS.textSlotMismatch,
    );
  });

  it('accepts localized punctuation moved out of a presentation-only wrapper', () => {
    const output = JSON.stringify({
      translatedHtml: '<p>Bdeir 说道<strong></strong>。</p>',
      appliedTermIds: [],
    });

    const result = parseTranslationOutput(
      '<p>Bdeir said<strong>.</strong></p>',
      output,
    );

    expect(result.translatedText).toBe('Bdeir 说道。');
    expect(result.translatedHtml).toBe('<p>Bdeir 说道。</p>');
  });

  it('accepts an omitted punctuation-only formatting wrapper', () => {
    const result = parseTranslationOutput(
      '<p>Source<strong>!</strong></p>',
      JSON.stringify({
        translatedHtml: '<p>译文！</p>',
        appliedTermIds: [],
      }),
    );

    expect(result.translatedText).toBe('译文！');
    expect(result.translatedHtml).toBe('<p>译文！</p>');
  });

  it('accepts an added punctuation-only formatting wrapper', () => {
    const result = parseTranslationOutput(
      '<p>Source!</p>',
      JSON.stringify({
        translatedHtml: '<p>译文<strong>！</strong></p>',
        appliedTermIds: [],
      }),
    );

    expect(result.translatedText).toBe('译文！');
    expect(result.translatedHtml).toBe('<p>译文！</p>');
  });

  it('normalizes mixed Chinese scripts to the selected target language', () => {
    const simplified = parseTranslationOutput(
      '<p>Software has been released.</p>',
      JSON.stringify({
        translatedHtml: '<p>軟體已经發佈，數據保持一致。</p>',
        appliedTermIds: [],
      }),
      [],
      'zh-CN',
    );
    const hongKongTraditional = parseTranslationOutput(
      '<p>Software has been released.</p>',
      JSON.stringify({
        translatedHtml: '<p>软件已经发布，数据保持一致。</p>',
        appliedTermIds: [],
      }),
      [],
      'zh-HK',
    );

    expect(simplified.translatedText).toBe('软体已经发布，数据保持一致。');
    expect(hongKongTraditional.translatedText).toBe('軟件已經發布，數據保持一致。');
  });
});
