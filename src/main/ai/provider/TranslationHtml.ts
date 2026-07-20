import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import type { TranslationTerminologyMatch } from '../../../shared/contracts/translation.types';
import {
  TRANSLATION_ERROR_CODES,
  TranslationError,
} from '../../../shared/errors/translation.errors';

export interface ParsedTranslationOutput {
  translatedText: string;
  translatedHtml: string;
  terminologyMatches: TranslationTerminologyMatch[];
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
): ParsedTranslationOutput {
  const trimmed = providerOutput.trim();
  if (!trimmed) {
    throw new TranslationError(
      TRANSLATION_ERROR_CODES.TRANSLATION_EMPTY_OUTPUT,
      'The provider returned an empty Translation segment.',
      true,
    );
  }

  const envelope = parseEnvelope(trimmed);
  const sourceRoot = parseSingleSafeRoot(sourceHtml);
  const translatedRoot = envelope
    ? parseSingleSafeRoot(envelope.translatedHtml)
    : buildPlainTextFallback(sourceRoot, trimmed);

  normalizeInsignificantFormatting(sourceRoot, translatedRoot);
  copyAndValidateStructure(sourceRoot, translatedRoot);
  const translatedHtml = sanitizeHtml(translatedRoot.outerHTML);
  const verifiedRoot = parseSingleSafeRoot(translatedHtml);
  const translatedText = normalizeWhitespace(verifiedRoot.textContent ?? '');
  if (!translatedText) {
    throw new TranslationError(
      TRANSLATION_ERROR_CODES.TRANSLATION_EMPTY_OUTPUT,
      'The provider returned a Translation segment without readable text.',
      true,
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
  if (roots.length !== 1) {
    throw invalidStructure('Translation output must contain exactly one root element.');
  }
  const root = roots[0];
  if (!root) throw invalidStructure('Translation output has no root element.');
  return root;
}

function buildPlainTextFallback(sourceRoot: Element, text: string): Element {
  const clone = sourceRoot.cloneNode(false) as Element;
  clone.textContent = text;
  return clone;
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
  const sourceElements = [sourceRoot, ...Array.from(sourceRoot.querySelectorAll('*'))];
  const translatedElements = [translatedRoot, ...Array.from(translatedRoot.querySelectorAll('*'))];
  if (sourceElements.length !== translatedElements.length) return;

  const formattingPairs = sourceElements.flatMap((source, index) => {
    if (!source.matches(INSIGNIFICANT_FORMATTING_SELECTOR)) return [];
    const text = source.textContent ?? '';
    if (text.trim() && !PUNCTUATION_ONLY.test(text)) return [];
    const translated = translatedElements[index];
    return translated?.tagName === source.tagName ? [{ source, translated }] : [];
  }).reverse();

  formattingPairs.forEach(({ source, translated }) => {
    source.replaceWith(...Array.from(source.childNodes));
    translated.replaceWith(...Array.from(translated.childNodes));
  });
  sourceRoot.normalize();
  translatedRoot.normalize();
}

function copyAndValidateStructure(sourceRoot: Element, translatedRoot: Element): void {
  const sourceElements = [sourceRoot, ...Array.from(sourceRoot.querySelectorAll('*'))];
  const translatedElements = [translatedRoot, ...Array.from(translatedRoot.querySelectorAll('*'))];
  if (sourceElements.length !== translatedElements.length) {
    throw invalidStructure('Translation output changed the Reader element structure.');
  }

  const sourceIndexes = new Map(sourceElements.map((element, index) => [element, index]));
  const translatedIndexes = new Map(translatedElements.map((element, index) => [element, index]));
  sourceElements.forEach((source, index) => {
    const translated = translatedElements[index];
    if (!translated || source.tagName !== translated.tagName) {
      throw invalidStructure('Translation output changed a Reader element tag.');
    }
    const sourceParentIndex = source.parentElement
      ? sourceIndexes.get(source.parentElement)
      : undefined;
    const translatedParentIndex = translated.parentElement
      ? translatedIndexes.get(translated.parentElement)
      : undefined;
    if (sourceParentIndex !== translatedParentIndex) {
      throw invalidStructure('Translation output changed the Reader element nesting.');
    }
    if (directTextSlotCount(source) !== directTextSlotCount(translated)) {
      throw invalidStructure('Translation output moved text outside its Reader style boundary.');
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

function invalidStructure(message: string): TranslationError {
  return new TranslationError(
    TRANSLATION_ERROR_CODES.TRANSLATION_INVALID_STRUCTURE,
    message,
    true,
  );
}
