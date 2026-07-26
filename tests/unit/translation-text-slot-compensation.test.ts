import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  createTranslationTextSlotPlan,
} from '../../src/main/ai/provider/TranslationHtml';
import {
  TranslationTextSlotStreamParser,
} from '../../src/main/ai/provider/TranslationTextSlotCompensation';
import {
  TRANSLATION_OUTPUT_REASON_CODES,
} from '../../src/main/ai/TranslationOutputDiagnostics';

function structureSignature(html: string): Array<{
  tagName: string;
  parentIndex: number;
  attributes: Array<[string, string]>;
  directTextSlotCount: number;
}> {
  const dom = new JSDOM(`<body>${html}</body>`);
  const root = dom.window.document.body.firstElementChild;
  if (!root) throw new Error('Expected a single HTML root.');
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  return elements.map((element) => ({
    tagName: element.tagName,
    parentIndex: element.parentElement === dom.window.document.body
      ? -1
      : elements.indexOf(element.parentElement as Element),
    attributes: Array.from(element.attributes)
      .map((attribute) => [attribute.name, attribute.value] as [string, string])
      .sort(([left], [right]) => left.localeCompare(right)),
    directTextSlotCount: Array.from(element.childNodes)
      .filter((node) => node.nodeType === dom.window.Node.TEXT_NODE && Boolean(node.textContent?.trim()))
      .length,
  }));
}

function expectReason(
  action: () => unknown,
  reasonCode: string,
): void {
  try {
    action();
    throw new Error('Expected an invalid text-slot response.');
  } catch (error) {
    expect(error).toMatchObject({ reasonCode });
  }
}

describe('Translation text-slot compensation', () => {
  it('rebuilds a synthetic seven-slot complex DOM with all source structure intact', () => {
    // This deliberately matches the affected segment's safe structural shape
    // (P + STRONG + A + EM and seven text slots), without reproducing content.
    const sourceHtml = '<p>alpha <strong>beta</strong> three <a href="https://example.test/fixed" title="fixed">four</a> five <em>six</em> seven</p>';
    const plan = createTranslationTextSlotPlan(sourceHtml);

    expect(plan.textSlots.map((slot) => slot.textSlotId)).toEqual([
      'slot-0001',
      'slot-0002',
      'slot-0003',
      'slot-0004',
      'slot-0005',
      'slot-0006',
      'slot-0007',
    ]);

    const translated = new Map(plan.textSlots.map((slot, index) => [
      slot.textSlotId,
      index === 2 ? '<script>literal markup</script>' : `translated-${index + 1}`,
    ]));
    const result = plan.rebuild(translated);

    expect(structureSignature(result.translatedHtml)).toEqual(structureSignature(sourceHtml));
    expect(result.translatedHtml).toContain('href="https://example.test/fixed"');
    expect(result.translatedHtml).toContain('title="fixed"');
    expect(result.translatedHtml).toContain('&lt;script&gt;literal markup&lt;/script&gt;');
    expect(new JSDOM(`<body>${result.translatedHtml}</body>`).window.document.body
      .querySelector('script')).toBeNull();
  });

  it('preserves whitespace-only nodes, entities, void elements, and protected code', () => {
    const sourceHtml = '<p>first<strong>second</strong>   <em>third</em>&amp;<br> fourth<code>fixed-code</code></p>';
    const plan = createTranslationTextSlotPlan(sourceHtml);
    const translated = new Map(plan.textSlots.map((slot, index) => [
      slot.textSlotId,
      slot.sourceText === '&' ? '&' : `slot-${index + 1}`,
    ]));
    const result = plan.rebuild(translated);

    expect(structureSignature(result.translatedHtml)).toEqual(structureSignature(sourceHtml));
    expect(result.translatedHtml).toContain('</strong>   <em>');
    expect(result.translatedHtml).toContain('&amp;');
    expect(result.translatedHtml).toContain('<br>');
    expect(result.translatedHtml).toContain('<code>fixed-code</code>');

    const protectedOnly = createTranslationTextSlotPlan('<p><code>fixed-code</code></p>');
    expect(protectedOnly.textSlots).toEqual([]);
    expect(protectedOnly.rebuild(new Map())).toEqual({
      translatedText: 'fixed-code',
      translatedHtml: '<p><code>fixed-code</code></p>',
    });
  });

  it('accepts a final valid NDJSON record without a trailing newline', () => {
    const parser = new TranslationTextSlotStreamParser();
    expect(parser.append('{"textSlotId":"slot-0001","translatedText":"done","appliedTermIds":[]}'))
      .toEqual([]);
    expect(parser.finish()).toEqual([{
      textSlotId: 'slot-0001',
      translatedText: 'done',
      appliedTermIds: [],
    }]);
  });

  it('classifies malformed, incomplete, missing-ID, invalid-field, and empty-slot records', () => {
    expectReason(() => new TranslationTextSlotStreamParser().append('not-json\n'),
      TRANSLATION_OUTPUT_REASON_CODES.ndjsonSyntax);
    expectReason(() => {
      const parser = new TranslationTextSlotStreamParser();
      parser.append('{"textSlotId":"slot-0001"');
      parser.finish();
    }, TRANSLATION_OUTPUT_REASON_CODES.streamTailIncomplete);
    expectReason(() => {
      const parser = new TranslationTextSlotStreamParser();
      parser.append('{"translatedText":"done","appliedTermIds":[]}\n');
    }, TRANSLATION_OUTPUT_REASON_CODES.textSlotIdMissing);
    expectReason(() => {
      const parser = new TranslationTextSlotStreamParser();
      parser.append('{"textSlotId":"slot-0001","translatedText":5,"appliedTermIds":[]}\n');
    }, TRANSLATION_OUTPUT_REASON_CODES.invalidFieldType);
    expectReason(() => {
      const parser = new TranslationTextSlotStreamParser();
      parser.append('{"textSlotId":"slot-0001","translatedText":" ","appliedTermIds":[]}\n');
    }, TRANSLATION_OUTPUT_REASON_CODES.translatedTextEmpty);
  });
});
