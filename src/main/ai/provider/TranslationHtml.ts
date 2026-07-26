import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import type {
  TranslationTargetLanguage,
  TranslationTerminologyMatch,
} from '../../../shared/contracts/translation.types';
import { normalizeChineseTargetText } from './ChineseScript';
import { isTranslationOutputLanguageConsistent } from './TranslationLanguage';
import {
  emptyTranslationOutput,
  invalidTranslationHtmlStructure,
  invalidTranslationStructure,
  invalidTranslationTargetLanguage,
  TRANSLATION_HTML_VALIDATION_REASONS,
  TRANSLATION_OUTPUT_REASON_CODES,
  type TranslationHtmlValidationReason,
} from '../TranslationOutputDiagnostics';

export interface ParsedTranslationOutput {
  translatedText: string;
  translatedHtml: string;
  terminologyMatches: TranslationTerminologyMatch[];
}

export interface TranslationTextSlot {
  textSlotId: string;
  sourceText: string;
}

export interface TranslationTextSlotPlan {
  textSlots: readonly TranslationTextSlot[];
  rebuild(
    translatedTextBySlotId: ReadonlyMap<string, string>,
    targetLanguage?: TranslationTargetLanguage,
  ): Pick<ParsedTranslationOutput, 'translatedText' | 'translatedHtml'>;
}

interface TranslationOutputEnvelope {
  translatedHtml: string;
  appliedTermIds: string[];
}

const INSIGNIFICANT_FORMATTING_SELECTOR = 'strong, b, em, i, u, s, mark, small';
const PUNCTUATION_ONLY = /^[\p{P}\s]+$/u;

const htmlDom = new JSDOM('');
const htmlDocument = htmlDom.window.document;
const htmlPurifier = createDOMPurify(
  htmlDom.window as unknown as Parameters<typeof createDOMPurify>[0],
);

export function parseTranslationOutput(
  sourceHtml: string,
  providerOutput: string,
  terminologyCandidates: TranslationTerminologyMatch[] = [],
  targetLanguage?: TranslationTargetLanguage,
): ParsedTranslationOutput {
  const trimmed = providerOutput.trim();
  if (!trimmed) {
    throw emptyTranslationOutput(
      'The provider returned an empty Translation segment.',
    );
  }

  const envelope = parseEnvelope(trimmed);
  const sourceRoot = parseSingleSafeRoot(sourceHtml);
  const translatedRoot = envelope
    ? parseSingleSafeRoot(envelope.translatedHtml)
    : buildPlainTextFallback(sourceRoot, trimmed);

  normalizeInsignificantFormatting(sourceRoot, translatedRoot);
  copyAndValidateStructure(sourceRoot, translatedRoot);
  if (targetLanguage) {
    normalizeElementTextNodes(translatedRoot, targetLanguage);
  }
  const translatedHtml = sanitizeHtml(translatedRoot.outerHTML);
  const verifiedRoot = parseSingleSafeRoot(translatedHtml);
  if (targetLanguage) {
    validateTargetLanguage(verifiedRoot, targetLanguage);
  }
  const translatedText = normalizeWhitespace(verifiedRoot.textContent ?? '');
  if (!translatedText) {
    throw emptyTranslationOutput(
      'The provider returned a Translation segment without readable text.',
    );
  }

  const appliedIds = new Set(envelope?.appliedTermIds ?? []);
  return {
    translatedText,
    translatedHtml,
    terminologyMatches: terminologyCandidates.filter((candidate) =>
      appliedIds.has(toTermId(candidate))),
  };
}

/**
 * Builds a one-shot, source-DOM-backed plan for HTML-recovery compensation.
 * Only non-empty, non-protected text nodes are exposed to a provider. The
 * original DOM is the sole source of elements, nesting, and attributes.
 */
export function createTranslationTextSlotPlan(sourceHtml: string): TranslationTextSlotPlan {
  const root = parseSingleSafeRoot(sourceHtml);
  const bindings = collectTextSlotBindings(root);

  return {
    textSlots: bindings.map(({ textSlotId, sourceText }) => ({ textSlotId, sourceText })),
    rebuild(translatedTextBySlotId, targetLanguage) {
      bindings.forEach(({ textSlotId, sourceText, node }) => {
        const translatedText = translatedTextBySlotId.get(textSlotId);
        if (translatedText === undefined) {
          throw invalidTranslationStructure(
            TRANSLATION_OUTPUT_REASON_CODES.expectedTextSlotMissing,
            'completion',
            'A Translation text-slot compensation response was incomplete.',
          );
        }
        node.data = restoreTextBoundaryWhitespace(sourceText, translatedText);
      });
      if (targetLanguage) normalizeElementTextNodes(root, targetLanguage);
      const translatedHtml = sanitizeHtml(root.outerHTML);
      const verifiedRoot = parseSingleSafeRoot(translatedHtml);
      if (targetLanguage) {
        validateTargetLanguage(verifiedRoot, targetLanguage);
      }
      const translatedText = normalizeWhitespace(verifiedRoot.textContent ?? '');
      if (!translatedText) {
        throw emptyTranslationOutput(
          'The provider returned a Translation segment without readable text.',
        );
      }
      return { translatedText, translatedHtml };
    },
  };
}

function normalizeElementTextNodes(
  root: Element,
  targetLanguage: TranslationTargetLanguage,
): void {
  const textNodes: Text[] = [];
  const walker = htmlDocument.createTreeWalker(
    root,
    htmlDom.window.NodeFilter.SHOW_TEXT,
  );
  let current = walker.nextNode();
  while (current) {
    const parent = current.parentElement;
    if (!parent?.closest('code, pre, kbd, samp')) {
      textNodes.push(current as Text);
    }
    current = walker.nextNode();
  }
  textNodes.forEach((node) => {
    node.data = normalizeChineseTargetText(node.data, targetLanguage);
  });
}

function validateTargetLanguage(
  root: Element,
  targetLanguage: TranslationTargetLanguage,
): void {
  const textNodes: string[] = [];
  const walker = htmlDocument.createTreeWalker(
    root,
    htmlDom.window.NodeFilter.SHOW_TEXT,
  );
  let current = walker.nextNode();
  while (current) {
    if (!current.parentElement?.closest('code, pre, kbd, samp')) {
      textNodes.push(current.textContent ?? '');
    }
    current = walker.nextNode();
  }
  if (isTranslationOutputLanguageConsistent(textNodes.join(' '), targetLanguage)) return;
  throw invalidTranslationTargetLanguage(
    'The provider returned text that does not match the selected target language.',
  );
}

function parseEnvelope(value: string): TranslationOutputEnvelope | undefined {
  const json = value
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.translatedHtml !== 'string'
      || !Array.isArray(record.appliedTermIds)
      || !record.appliedTermIds.every((item) => typeof item === 'string')
    ) {
      return undefined;
    }
    return {
      translatedHtml: record.translatedHtml,
      appliedTermIds: record.appliedTermIds,
    };
  } catch {
    return undefined;
  }
}

function parseSingleSafeRoot(value: string): Element {
  const sanitized = sanitizeHtml(value);
  const template = htmlDocument.createElement('template');
  template.innerHTML = sanitized;
  const roots = Array.from(template.content.children);
  if (roots.length === 0) {
    throw invalidStructure(
      TRANSLATION_HTML_VALIDATION_REASONS.rootMissing,
      'Translation output has no root element.',
    );
  }
  if (roots.length > 1) {
    throw invalidStructure(
      TRANSLATION_HTML_VALIDATION_REASONS.multipleRoots,
      'Translation output must contain exactly one root element.',
    );
  }
  const root = roots[0];
  if (!root) {
    throw invalidStructure(
      TRANSLATION_HTML_VALIDATION_REASONS.rootMissing,
      'Translation output has no root element.',
    );
  }
  return root;
}

function buildPlainTextFallback(sourceRoot: Element, text: string): Element {
  const clone = sourceRoot.cloneNode(false) as Element;
  clone.textContent = text;
  return clone;
}

interface TextSlotBinding extends TranslationTextSlot {
  node: Text;
}

function collectTextSlotBindings(root: Element): TextSlotBinding[] {
  const bindings: TextSlotBinding[] = [];
  const walker = htmlDocument.createTreeWalker(
    root,
    htmlDom.window.NodeFilter.SHOW_TEXT,
  );
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    if (
      node.data.trim()
      && !node.parentElement?.closest('code, pre, kbd, samp')
    ) {
      bindings.push({
        textSlotId: `slot-${String(bindings.length + 1).padStart(4, '0')}`,
        sourceText: node.data,
        node,
      });
    }
    current = walker.nextNode();
  }
  return bindings;
}

function restoreTextBoundaryWhitespace(sourceText: string, translatedText: string): string {
  const leadingWhitespace = sourceText.match(/^\s*/u)?.[0] ?? '';
  const trailingWhitespace = sourceText.match(/\s*$/u)?.[0] ?? '';
  return `${leadingWhitespace}${translatedText.trim()}${trailingWhitespace}`;
}

/**
 * Readability can preserve presentation-only wrappers around punctuation,
 * such as `<strong>.</strong>`. Translators commonly localize that punctuation
 * outside the empty wrapper. Removing only empty or punctuation-only
 * formatting nodes keeps meaningful styled text strict while avoiding a
 * visually irrelevant structure mismatch.
 */
function normalizeInsignificantFormatting(
  sourceRoot: Element,
  translatedRoot: Element,
): void {
  unwrapInsignificantFormatting(sourceRoot);
  unwrapInsignificantFormatting(translatedRoot);
}

function unwrapInsignificantFormatting(root: Element): void {
  const formattingNodes = Array.from(root.querySelectorAll(
    INSIGNIFICANT_FORMATTING_SELECTOR,
  )).filter((element) => {
    const text = element.textContent ?? '';
    return !text.trim() || PUNCTUATION_ONLY.test(text);
  }).reverse();

  formattingNodes.forEach((element) => {
    element.replaceWith(...Array.from(element.childNodes));
  });
  root.normalize();
}

function copyAndValidateStructure(sourceRoot: Element, translatedRoot: Element): void {
  const sourceElements = [sourceRoot, ...Array.from(sourceRoot.querySelectorAll('*'))];
  const translatedElements = [translatedRoot, ...Array.from(translatedRoot.querySelectorAll('*'))];
  if (sourceElements.length !== translatedElements.length) {
    throw invalidStructure(
      TRANSLATION_HTML_VALIDATION_REASONS.elementCountMismatch,
      'Translation output changed the Reader element structure.',
    );
  }

  const sourceIndexes = new Map(sourceElements.map((element, index) => [element, index]));
  const translatedIndexes = new Map(translatedElements.map((element, index) => [element, index]));
  sourceElements.forEach((source, index) => {
    const translated = translatedElements[index];
    if (!translated || source.tagName !== translated.tagName) {
      throw invalidStructure(
        TRANSLATION_HTML_VALIDATION_REASONS.elementTagMismatch,
        'Translation output changed a Reader element tag.',
      );
    }
    const sourceParentIndex = source.parentElement
      ? sourceIndexes.get(source.parentElement)
      : undefined;
    const translatedParentIndex = translated.parentElement
      ? translatedIndexes.get(translated.parentElement)
      : undefined;
    if (sourceParentIndex !== translatedParentIndex) {
      throw invalidStructure(
        TRANSLATION_HTML_VALIDATION_REASONS.elementNestingMismatch,
        'Translation output changed the Reader element nesting.',
      );
    }
    if (directTextSlotCount(source) !== directTextSlotCount(translated)) {
      throw invalidStructure(
        TRANSLATION_HTML_VALIDATION_REASONS.textSlotMismatch,
        'Translation output moved text outside its Reader style boundary.',
      );
    }
    Array.from(translated.attributes).forEach((attribute) => {
      translated.removeAttribute(attribute.name);
    });
    Array.from(source.attributes).forEach((attribute) => {
      translated.setAttribute(attribute.name, attribute.value);
    });
  });
}

function directTextSlotCount(element: Element): number {
  return Array.from(element.childNodes).filter((node) =>
    node.nodeType === node.TEXT_NODE && Boolean(node.textContent?.trim()))
    .length;
}

function sanitizeHtml(value: string): string {
  return htmlPurifier.sanitize(value, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['srcdoc'],
  });
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function toTermId(match: TranslationTerminologyMatch): string {
  return `${match.sourceId}:${match.conceptId}`;
}

function invalidStructure(
  htmlValidationReason: TranslationHtmlValidationReason,
  message: string,
) {
  return invalidTranslationHtmlStructure(htmlValidationReason, message);
}
