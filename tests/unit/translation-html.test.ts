import { describe, expect, it } from 'vitest';
import { parseTranslationOutput } from '../../src/main/ai/TranslationHtml';

describe('parseTranslationOutput', () => {
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

  it('rejects a provider response that changes the element structure', () => {
    const output = JSON.stringify({
      translatedHtml: '<p><strong>译文</strong><em>额外结构</em></p>',
      appliedTermIds: [],
    });

    expect(() => parseTranslationOutput('<p><strong>Source</strong></p>', output))
      .toThrow('changed the Reader element structure');
  });

  it('rejects a provider response that reparents an existing element', () => {
    const output = JSON.stringify({
      translatedHtml: '<p><strong>First<em>second</em></strong></p>',
      appliedTermIds: [],
    });

    expect(() => parseTranslationOutput(
      '<p><strong>First</strong><em>second</em></p>',
      output,
    )).toThrow('changed the Reader element nesting');
  });

  it('rejects moving translated text outside its original style boundary', () => {
    const output = JSON.stringify({
      translatedHtml: '<p><strong></strong>Translated as plain text</p>',
      appliedTermIds: [],
    });

    expect(() => parseTranslationOutput(
      '<p><strong>Bold source</strong></p>',
      output,
    )).toThrow('moved text outside its Reader style boundary');
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
});
