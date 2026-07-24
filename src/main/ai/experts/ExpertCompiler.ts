import { createHash } from 'node:crypto';
import { parseDocument, visit } from 'yaml';
import {
  EXPERT_TEMPLATE_VARIABLES,
  type TranslationExpertImportPreview,
} from '../../../shared/contracts/translation-expert.types';

const MAX_YAML_CHARACTERS = 100_000;
const MAX_INSTRUCTION_CHARACTERS = 20_000;
const MAX_DEPTH = 10;
const EXPERT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;
const SUPPORTED_FIELDS = new Set([
  'id',
  'version',
  'name',
  'description',
  'author',
  'details',
  'matches',
  'instruction',
  'systemPrompt',
  'multipleSystemPrompt',
  'prompt',
  'multiplePrompt',
  'langOverrides',
  'env',
  'enableRichTranslate',
  'i18n',
  'avatar',
]);

export function compileUserExpertYaml(yaml: string): TranslationExpertImportPreview {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ignoredFields: string[] = [];
  if (!yaml.trim()) errors.push('Choose a non-empty UTF-8 YAML expert file.');
  if (yaml.length > MAX_YAML_CHARACTERS) {
    errors.push(`Expert YAML must not exceed ${MAX_YAML_CHARACTERS} characters.`);
  }
  if (errors.length) {
    return emptyPreview(errors);
  }

  const document = parseDocument(yaml, {
    schema: 'core',
    uniqueKeys: true,
  });
  document.errors.forEach((error) => errors.push(`YAML: ${error.message}`));
  visit(document, {
    Node(_key, node) {
      const taggedNode = node as { tag?: string };
      if (taggedNode.tag?.startsWith('!')) {
        errors.push(`Custom YAML tag ${taggedNode.tag} is not allowed.`);
      }
    },
  });

  let parsed: unknown;
  if (!errors.length) {
    try {
      parsed = document.toJS({ maxAliasCount: 0 });
      validateSafeValue(parsed, 0, errors);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unable to read YAML safely.');
    }
  }
  if (!isRecord(parsed)) {
    if (!errors.length) errors.push('The expert file must contain one YAML mapping.');
    return emptyPreview(errors);
  }

  Object.keys(parsed).forEach((field) => {
    if (!SUPPORTED_FIELDS.has(field) && !isVersionPatchedPrompt(field)) {
      ignoredFields.push(field);
    }
  });
  validateEnv(parsed.env, errors);

  const id = requiredString(parsed.id, 'id', errors);
  const version = requiredString(parsed.version, 'version', errors);
  const name = requiredString(parsed.name, 'name', errors);
  if (id && !EXPERT_ID_PATTERN.test(id)) {
    errors.push('id must be 2–64 letters, numbers, dots, underscores, or hyphens.');
  }
  if (id === 'none') errors.push('id `none` is reserved by Shale.');
  const selectedPrompt = selectPrompt(parsed);
  if (!selectedPrompt) {
    errors.push('Provide instruction, systemPrompt, or multipleSystemPrompt.');
  }

  let instruction = '';
  if (selectedPrompt) {
    const compiled = sanitizeExpertInstruction(selectedPrompt.value, true);
    instruction = compiled.instruction;
    warnings.push(`Selected ${selectedPrompt.field} as the domain/style instruction.`);
    warnings.push(...compiled.warnings);
    errors.push(...compiled.errors);
    if (instruction.length > MAX_INSTRUCTION_CHARACTERS) {
      errors.push(`Compiled instruction must not exceed ${MAX_INSTRUCTION_CHARACTERS} characters.`);
    }
  }
  if (ignoredFields.length) {
    warnings.push(`Ignored unsupported fields: ${ignoredFields.join(', ')}`);
  }
  if (errors.length || !id || !version || !name) {
    return emptyPreview(errors, warnings, ignoredFields);
  }

  const normalized = {
    id,
    version,
    name,
    description: optionalString(parsed.description),
    author: optionalString(parsed.author) || 'User',
    details: optionalString(parsed.details),
    matches: stringArray(parsed.matches, 'matches', errors),
    instruction,
  };
  if (errors.length) return emptyPreview(errors, warnings, ignoredFields);
  const contentHash = sha256(JSON.stringify(normalized));
  return {
    valid: true,
    expert: {
      ...normalized,
      origin: 'user',
      contentHash,
      warnings: Array.from(new Set(warnings)),
    },
    warnings: Array.from(new Set(warnings)),
    errors: [],
    ignoredFields,
    replacesExistingUserExpert: false,
  };
}

export function renderExpertInstruction(
  instruction: string,
  sourceLanguage: string,
  targetLanguage: string,
): string {
  return instruction
    .replaceAll('{{sourceLanguage}}', sourceLanguage)
    .replaceAll('{{targetLanguage}}', targetLanguage);
}

function sanitizeExpertInstruction(
  source: string,
  rejectUnknownVariables: boolean,
): { instruction: string; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  let instruction = source
    .replaceAll('{{to}}', '{{targetLanguage}}')
    .replaceAll('{{from}}', '{{sourceLanguage}}')
    .replace(/\{\{(?:title_prompt|summary_prompt|terms_prompt)\}\}/g, '');
  const variables = Array.from(instruction.matchAll(/\{\{([^{}]+)\}\}/g))
    .map((match) => match[1]);
  const unsupported = Array.from(new Set(variables.filter((variable) =>
    !(EXPERT_TEMPLATE_VARIABLES as readonly string[]).includes(variable))));
  if (unsupported.length) {
    const message = `Unknown template variables: ${unsupported.join(', ')}`;
    if (rejectUnknownVariables) errors.push(message);
    else warnings.push(message);
  }

  const transportPatterns = [
    /\boutput only\b/i,
    /\breturn only\b/i,
    /\bdo not include (?:explanations|additional content)\b/i,
    /\binput[- ]output format\b/i,
    /\byaml\b/i,
    /\bjson\b/i,
    /\bhtml tags?\b/i,
  ];
  instruction = instruction
    .split(/\r?\n/)
    .filter((line) => {
      const remove = transportPatterns.some((pattern) => pattern.test(line));
      if (remove) warnings.push(`Removed transport instruction: ${line.trim()}`);
      return !remove;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!instruction) errors.push('No safe domain/style instruction remained after validation.');
  return { instruction, warnings, errors };
}

function selectPrompt(value: Record<string, unknown>): { field: string; value: string } | undefined {
  const directFields = ['instruction'];
  for (const field of directFields) {
    if (typeof value[field] === 'string' && value[field].trim()) {
      return { field, value: value[field] };
    }
  }
  const patched = Object.entries(value)
    .flatMap(([field, candidate]) => {
      const match = /^systemPrompt\.add_v\.\[([^\]]+)\]$/.exec(field);
      return match && typeof candidate === 'string' && candidate.trim()
        ? [{ field, version: match[1], value: candidate }]
        : [];
    })
    .sort((left, right) => right.version.localeCompare(left.version, undefined, {
      numeric: true,
    }));
  if (patched[0]) return patched[0];
  for (const field of ['systemPrompt', 'multipleSystemPrompt']) {
    if (typeof value[field] === 'string' && value[field].trim()) {
      return { field, value: value[field] };
    }
  }
  return undefined;
}

function validateSafeValue(value: unknown, depth: number, errors: string[]): void {
  if (depth > MAX_DEPTH) {
    errors.push(`YAML nesting must not exceed ${MAX_DEPTH} levels.`);
    return;
  }
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => validateSafeValue(item, depth + 1, errors));
    return;
  }
  if (!isRecord(value)) {
    errors.push('YAML contains an unsupported value type.');
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) {
      errors.push(`Unsafe mapping key ${key} is not allowed.`);
    }
    validateSafeValue(child, depth + 1, errors);
  }
}

function validateEnv(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push('env must be a mapping of string values.');
    return;
  }
  if (Object.values(value).some((entry) => typeof entry !== 'string')) {
    errors.push('Every env value must be a string.');
  }
}

function stringArray(value: unknown, field: string, errors: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    errors.push(`${field} must be an array of strings.`);
    return [];
  }
  return value.slice(0, 100).map((entry) => entry.trim()).filter(Boolean);
}

function requiredString(
  value: unknown,
  field: string,
  errors: string[],
): string | undefined {
  const normalized = optionalString(value);
  if (!normalized) errors.push(`${field} is required and must be a string.`);
  return normalized || undefined;
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isVersionPatchedPrompt(field: string): boolean {
  return /^(?:systemPrompt|multipleSystemPrompt|prompt|multiplePrompt)\.(?:add|remove)_v\.\[[^\]]+\]$/
    .test(field);
}

function emptyPreview(
  errors: string[],
  warnings: string[] = [],
  ignoredFields: string[] = [],
): TranslationExpertImportPreview {
  return {
    valid: false,
    warnings: Array.from(new Set(warnings)),
    errors: Array.from(new Set(errors)),
    ignoredFields,
    replacesExistingUserExpert: false,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
