export interface TranslationBatchOutput {
  sourceSegmentId: string;
  translatedHtml: string;
  appliedTermIds: string[];
}

/** Incrementally decodes provider Translation objects, including harmless formatting. */
export class TranslationBatchStreamParser {
  private buffer = '';

  append(delta: string): TranslationBatchOutput[] {
    this.buffer += delta;
    return this.drain(false);
  }

  finish(): TranslationBatchOutput[] {
    try {
      return this.drain(true);
    } finally {
      this.buffer = '';
    }
  }

  private drain(isFinal: boolean): TranslationBatchOutput[] {
    const completed: TranslationBatchOutput[] = [];
    while (this.buffer.length > 0) {
      this.buffer = this.buffer.trimStart();
      if (!this.buffer) return completed;

      if (this.buffer.startsWith('`')) {
        const newlineIndex = this.buffer.search(/\r?\n/);
        if (newlineIndex < 0 && !isFinal) return completed;
        const fenceEnd = newlineIndex < 0 ? this.buffer.length : newlineIndex;
        const fence = this.buffer.slice(0, fenceEnd).trim();
        if (!/^```(?:json|jsonl|ndjson)?$/i.test(fence)) {
          throw invalidNdjson();
        }
        const newlineLength = newlineIndex >= 0 && this.buffer[newlineIndex] === '\r' ? 2 : 1;
        this.buffer = this.buffer.slice(fenceEnd + (newlineIndex < 0 ? 0 : newlineLength));
        continue;
      }

      if (!this.buffer.startsWith('{')) throw invalidNdjson();
      const objectEnd = findCompleteObjectEnd(this.buffer);
      if (objectEnd < 0) {
        if (isFinal) throw invalidNdjson();
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
      if (depth < 0) throw invalidNdjson();
    }
  }
  return -1;
}

function parseOutputObject(value: string): TranslationBatchOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalidNdjson();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The provider returned an invalid Translation batch object.');
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.sourceSegmentId !== 'string'
    || typeof record.translatedHtml !== 'string'
    || !Array.isArray(record.appliedTermIds)
    || !record.appliedTermIds.every((item) => typeof item === 'string')
  ) {
    throw new Error('The provider returned an incomplete Translation batch object.');
  }
  return {
    sourceSegmentId: record.sourceSegmentId,
    translatedHtml: record.translatedHtml,
    appliedTermIds: record.appliedTermIds,
  };
}

function invalidNdjson(): Error {
  return new Error('The provider returned invalid Translation NDJSON.');
}
