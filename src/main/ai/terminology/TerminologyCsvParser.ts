import { createHash } from 'node:crypto';
import {
  TRANSLATION_TARGET_LANGUAGES,
  type TranslationTargetLanguage,
} from '../../../shared/contracts/translation.types';
import type {
  TerminologyCsvIssue,
  TerminologyImportPreview,
  TerminologyImportPreviewEntry,
} from '../../../shared/contracts/translation-terminology.types';

const EXPECTED_HEADER = ['source', 'target', 'tgt_lng'] as const;
const MAX_CSV_CHARACTERS = 2_000_000;
const MAX_ROWS = 20_000;
const MAX_NAME_CHARACTERS = 120;
const MAX_SOURCE_CHARACTERS = 2_000;
const MAX_TARGET_CHARACTERS = 4_000;

interface CsvRow {
  line: number;
  fields: string[];
}

export function previewTerminologyCsv(
  nameInput: string,
  csvInput: string,
): TerminologyImportPreview {
  const name = nameInput.normalize('NFKC').trim();
  const errors: TerminologyCsvIssue[] = [];
  const warnings: TerminologyCsvIssue[] = [];
  if (!name || name.length > MAX_NAME_CHARACTERS) {
    errors.push({
      line: 1,
      code: 'FIELD_TOO_LONG',
      message: `Library name must contain 1–${MAX_NAME_CHARACTERS} characters.`,
    });
  }
  if (csvInput.length > MAX_CSV_CHARACTERS) {
    errors.push({
      line: 1,
      code: 'FIELD_TOO_LONG',
      message: `CSV content exceeds ${MAX_CSV_CHARACTERS.toLocaleString()} characters.`,
    });
    return emptyPreview(name, errors, warnings);
  }

  const parsed = parseCsv(csvInput.replace(/^\uFEFF/, ''));
  if ('issue' in parsed) {
    errors.push(parsed.issue);
    return emptyPreview(name, errors, warnings);
  }
  const [header, ...rows] = parsed.rows;
  if (
    !header
    || header.fields.length !== EXPECTED_HEADER.length
    || header.fields.some((field, index) => field !== EXPECTED_HEADER[index])
  ) {
    errors.push({
      line: header?.line ?? 1,
      code: 'INVALID_HEADER',
      message: 'The first row must be exactly source,target,tgt_lng.',
    });
    return emptyPreview(name, errors, warnings);
  }
  if (rows.length > MAX_ROWS) {
    errors.push({
      line: rows[MAX_ROWS]?.line ?? 1,
      code: 'FIELD_TOO_LONG',
      message: `A terminology library can contain at most ${MAX_ROWS.toLocaleString()} rows.`,
    });
  }

  const entries: TerminologyImportPreviewEntry[] = [];
  const firstByIdentity = new Map<string, TerminologyImportPreviewEntry>();
  for (const row of rows.slice(0, MAX_ROWS)) {
    if (row.fields.length === 1 && row.fields[0] === '') continue;
    if (row.fields.length !== EXPECTED_HEADER.length) {
      errors.push({
        line: row.line,
        code: 'MALFORMED_CSV',
        message: 'Each row must contain exactly three CSV fields.',
      });
      continue;
    }
    const source = row.fields[0].normalize('NFC').trim();
    const target = row.fields[1].normalize('NFC').trim();
    const languageInput = row.fields[2].trim();
    if (!source) {
      errors.push({
        line: row.line,
        code: 'EMPTY_SOURCE',
        message: 'source is required.',
      });
      continue;
    }
    if (
      source.length > MAX_SOURCE_CHARACTERS
      || target.length > MAX_TARGET_CHARACTERS
    ) {
      errors.push({
        line: row.line,
        code: 'FIELD_TOO_LONG',
        message: `source may contain at most ${MAX_SOURCE_CHARACTERS} characters and target at most ${MAX_TARGET_CHARACTERS}.`,
      });
      continue;
    }
    if (
      languageInput
      && !TRANSLATION_TARGET_LANGUAGES.includes(
        languageInput as TranslationTargetLanguage,
      )
    ) {
      errors.push({
        line: row.line,
        code: 'INVALID_TARGET_LANGUAGE',
        message: `Unsupported tgt_lng “${languageInput}”.`,
      });
      continue;
    }
    const entry: TerminologyImportPreviewEntry = {
      line: row.line,
      source,
      ...(target ? { target } : {}),
      ...(languageInput
        ? { targetLanguage: languageInput as TranslationTargetLanguage }
        : {}),
    };
    const identity = `${normalizeTerminologySource(source)}\u0000${languageInput}`;
    const existing = firstByIdentity.get(identity);
    if (existing) {
      const isDuplicate = (existing.target ?? '') === (entry.target ?? '');
      warnings.push({
        line: row.line,
        code: isDuplicate ? 'DUPLICATE' : 'CONFLICT',
        message: isDuplicate
          ? `Duplicate of line ${existing.line}; the first row will be used.`
          : `Conflicts with line ${existing.line}; the first row will be used.`,
      });
      continue;
    }
    firstByIdentity.set(identity, entry);
    entries.push(entry);
  }

  const contentHash = errors.length === 0
    ? createHash('sha256')
      .update(JSON.stringify(entries.map((entry) => ({
        source: entry.source,
        target: entry.target,
        targetLanguage: entry.targetLanguage,
      }))))
      .digest('hex')
    : undefined;
  return {
    valid: errors.length === 0,
    name,
    acceptedRowCount: entries.length,
    entries,
    errors,
    warnings,
    replacesExistingUserLibrary: false,
    ...(contentHash ? { contentHash } : {}),
  };
}

export function normalizeTerminologySource(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ');
}

function emptyPreview(
  name: string,
  errors: TerminologyCsvIssue[],
  warnings: TerminologyCsvIssue[],
): TerminologyImportPreview {
  return {
    valid: false,
    name,
    acceptedRowCount: 0,
    entries: [],
    errors,
    warnings,
    replacesExistingUserLibrary: false,
  };
}

function parseCsv(
  input: string,
): { rows: CsvRow[] } | { issue: TerminologyCsvIssue } {
  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let field = '';
  let line = 1;
  let rowLine = 1;
  let index = 0;
  let quoted = false;
  let closedQuote = false;

  const malformed = (message: string): { issue: TerminologyCsvIssue } => ({
    issue: {
      line,
      code: 'MALFORMED_CSV',
      message,
    },
  });
  const finishField = (): void => {
    fields.push(field);
    field = '';
    closedQuote = false;
  };
  const finishRow = (): void => {
    finishField();
    rows.push({ line: rowLine, fields });
    fields = [];
    rowLine = line + 1;
  };

  while (index < input.length) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        closedQuote = true;
        index += 1;
        continue;
      }
      if (character === '\r' && input[index + 1] === '\n') {
        field += '\r\n';
        line += 1;
        index += 2;
        continue;
      }
      if (character === '\n' || character === '\r') line += 1;
      field += character;
      index += 1;
      continue;
    }
    if (closedQuote && character !== ',' && character !== '\r' && character !== '\n') {
      return malformed('Unexpected character after a closing quote.');
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
      index += 1;
      continue;
    }
    if (character === '"') return malformed('A quote must begin a quoted field.');
    if (character === ',') {
      finishField();
      index += 1;
      continue;
    }
    if (character === '\r' || character === '\n') {
      finishRow();
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      line += 1;
      rowLine = line;
      index += 1;
      continue;
    }
    field += character;
    index += 1;
  }
  if (quoted) return malformed('The file ends inside a quoted field.');
  if (field.length || fields.length || input.length === 0) finishRow();
  return { rows };
}
