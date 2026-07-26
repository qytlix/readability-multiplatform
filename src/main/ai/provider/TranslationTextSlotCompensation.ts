import {
  TRANSLATION_OUTPUT_REASON_CODES,
  invalidTranslationStructure,
} from '../TranslationOutputDiagnostics';

export const TRANSLATION_COMPENSATION_PROTOCOLS = ['text-slots'] as const;
export type TranslationCompensationProtocol = (
  typeof TRANSLATION_COMPENSATION_PROTOCOLS
)[number];

export interface TranslationTextSlotOutput {
  textSlotId: string;
  translatedText: string;
  appliedTermIds: string[];
}

/** Incrementally decodes the constrained NDJSON response for text-slot recovery. */
export class TranslationTextSlotStreamParser {
  private buffer = '';

  append(delta: string): TranslationTextSlotOutput[] {
    this.buffer += delta;
    return this.drain(false);
  }

  finish(): TranslationTextSlotOutput[] {
    try {
      return this.drain(true);
    } finally {
      this.buffer = '';
    }
  }

  private drain(isFinal: boolean): TranslationTextSlotOutput[] {
    const completed: TranslationTextSlotOutput[] = [];
    while (this.buffer.length > 0) {
      this.buffer = this.buffer.trimStart();
      if (!this.buffer) return completed;

      if (this.buffer.startsWith('`')) {
        const newlineIndex = this.buffer.search(/\r?\n/);
        if (newlineIndex < 0 && !isFinal) return completed;
        const fenceEnd = newlineIndex < 0 ? this.buffer.length : newlineIndex;
        const fence = this.buffer.slice(0, fenceEnd).trim();
        if (!/^```(?:json|jsonl|ndjson)?$/i.test(fence)) {
          throw invalidNdjson(TRANSLATION_OUTPUT_REASON_CODES.ndjsonSyntax);
        }
        const newlineLength = newlineIndex >= 0 && this.buffer[newlineIndex] === '\r' ? 2 : 1;
        this.buffer = this.buffer.slice(fenceEnd + (newlineIndex < 0 ? 0 : newlineLength));
        continue;
      }

      if (!this.buffer.startsWith('{')) {
        throw invalidNdjson(TRANSLATION_OUTPUT_REASON_CODES.ndjsonSyntax);
      }
      const objectEnd = findCompleteObjectEnd(this.buffer);
      if (objectEnd < 0) {
        if (isFinal) {
          throw invalidNdjson(TRANSLATION_OUTPUT_REASON_CODES.streamTailIncomplete);
        }
        return completed;
      }
      if (objectEnd === this.buffer.length && !isFinal) return completed;

      completed.push(parseOutputObject(this.buffer.slice(0, objectEnd)));
      this.buffer = this.buffer.slice(objectEnd);
    }
    return completed;
  }
}

function findCompleteObjectEnd(value: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
      if (depth < 0) throw invalidNdjson(TRANSLATION_OUTPUT_REASON_CODES.ndjsonSyntax);
    }
  }
  return -1;
}

function parseOutputObject(value: string): TranslationTextSlotOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalidNdjson(TRANSLATION_OUTPUT_REASON_CODES.ndjsonSyntax);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidNdjson(TRANSLATION_OUTPUT_REASON_CODES.ndjsonSyntax);
  }
  const record = parsed as Record<string, unknown>;
  if (!Object.hasOwn(record, 'textSlotId') || !String(record.textSlotId ?? '').trim()) {
    throw invalidRecord(TRANSLATION_OUTPUT_REASON_CODES.textSlotIdMissing);
  }
  if (typeof record.textSlotId !== 'string') {
    throw invalidRecord(TRANSLATION_OUTPUT_REASON_CODES.invalidFieldType);
  }
  if (
    !Object.hasOwn(record, 'translatedText')
    || !Object.hasOwn(record, 'appliedTermIds')
  ) {
    throw invalidRecord(TRANSLATION_OUTPUT_REASON_CODES.requiredFieldMissing);
  }
  if (
    typeof record.translatedText !== 'string'
    || !Array.isArray(record.appliedTermIds)
    || !record.appliedTermIds.every((item) => typeof item === 'string')
  ) {
    throw invalidRecord(TRANSLATION_OUTPUT_REASON_CODES.invalidFieldType);
  }
  if (!record.translatedText.trim()) {
    throw invalidRecord(TRANSLATION_OUTPUT_REASON_CODES.translatedTextEmpty);
  }
  return {
    textSlotId: record.textSlotId,
    translatedText: record.translatedText,
    appliedTermIds: record.appliedTermIds,
  };
}

function invalidNdjson(reasonCode: typeof TRANSLATION_OUTPUT_REASON_CODES[
  'ndjsonSyntax' | 'streamTailIncomplete'
]) {
  return invalidTranslationStructure(
    reasonCode,
    'stream',
    'The provider returned invalid Translation text-slot NDJSON.',
  );
}

function invalidRecord(
  reasonCode: typeof TRANSLATION_OUTPUT_REASON_CODES[
    | 'textSlotIdMissing'
    | 'requiredFieldMissing'
    | 'invalidFieldType'
    | 'translatedTextEmpty'
  ],
) {
  return invalidTranslationStructure(
    reasonCode,
    'record',
    'The provider returned an invalid Translation text-slot object.',
  );
}
