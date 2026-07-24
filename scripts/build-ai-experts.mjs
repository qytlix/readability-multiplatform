import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

const SOURCE_REPOSITORY = 'https://github.com/immersive-translate/prompts.git';
const SOURCE_COMMIT = '94d6522081902fce6cbe07418c402b3a5ade99ca';
const OUTPUT_PATH = path.resolve('resources', 'ai-experts', 'experts.json');
const sourceArgument = process.argv.find((argument) => argument.startsWith('--source='));
const suppliedSource = sourceArgument?.slice('--source='.length);
const temporaryRoot = suppliedSource ? undefined : mkdtempSync(path.join(tmpdir(), 'shale-experts-'));
const sourceRoot = suppliedSource
  ? path.resolve(suppliedSource)
  : path.join(temporaryRoot, 'prompts');

try {
  if (!suppliedSource) {
    execFileSync('git', ['clone', '--quiet', SOURCE_REPOSITORY, sourceRoot], {
      stdio: 'inherit',
    });
    execFileSync('git', ['-C', sourceRoot, 'checkout', '--quiet', SOURCE_COMMIT], {
      stdio: 'inherit',
    });
  }

  const actualCommit = execFileSync(
    'git',
    ['-C', sourceRoot, 'rev-parse', 'HEAD'],
    { encoding: 'utf8' },
  ).trim();
  if (actualCommit !== SOURCE_COMMIT) {
    throw new Error(`Expected expert commit ${SOURCE_COMMIT}, received ${actualCommit}.`);
  }

  const pluginDirectory = path.join(sourceRoot, 'plugins');
  const experts = readdirSync(pluginDirectory)
    .filter((fileName) => /\.ya?ml$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => compileExpert(pluginDirectory, fileName));

  if (experts.length !== 29) {
    throw new Error(`Expected 29 built-in experts, compiled ${experts.length}.`);
  }
  const duplicateIds = experts
    .map((expert) => expert.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateIds.length) {
    throw new Error(`Duplicate built-in expert IDs: ${duplicateIds.join(', ')}`);
  }

  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify({
    schemaVersion: 1,
    sourceRepository: SOURCE_REPOSITORY.replace(/\.git$/, ''),
    sourceCommit: SOURCE_COMMIT,
    experts,
  }, null, 2)}\n`, 'utf8');
  process.stdout.write(`Compiled ${experts.length} AI experts to ${OUTPUT_PATH}\n`);
} finally {
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
}

function compileExpert(pluginDirectory, fileName) {
  const sourceFile = path.posix.join('plugins', fileName);
  const sourceText = readFileSync(path.join(pluginDirectory, fileName), 'utf8');
  const parsed = YAML.parse(sourceText);
  if (!isRecord(parsed)) throw new Error(`${sourceFile}: expected a YAML mapping.`);

  const id = requiredString(parsed.id, `${sourceFile}: id`);
  const version = requiredString(parsed.version, `${sourceFile}: version`);
  const name = stringValue(parsed.name) ?? id;
  const description = stringValue(parsed.description) ?? '';
  const author = stringValue(parsed.author) ?? 'Unknown';
  const promptSelection = selectSystemPrompt(parsed, sourceFile);
  const compiled = sanitizeInstruction(promptSelection.value);
  if (!compiled.instruction) {
    throw new Error(`${sourceFile}: no safe domain/style instruction remained.`);
  }

  const warnings = [
    ...promptSelection.warnings,
    ...compiled.warnings,
  ];
  const compiledIdentity = JSON.stringify({
    id,
    version,
    instruction: compiled.instruction,
  });
  return {
    id,
    version,
    name,
    description,
    author,
    details: stringValue(parsed.details) ?? '',
    matches: Array.isArray(parsed.matches)
      ? parsed.matches.filter((value) => typeof value === 'string').slice(0, 100)
      : [],
    instruction: compiled.instruction,
    sourceFile,
    sourceSha256: sha256(sourceText),
    compiledSha256: sha256(compiledIdentity),
    warnings,
  };
}

function selectSystemPrompt(parsed, sourceFile) {
  const patched = Object.entries(parsed)
    .flatMap(([key, value]) => {
      const match = /^systemPrompt\.add_v\.\[([^\]]+)\]$/.exec(key);
      return match && typeof value === 'string'
        ? [{ key, version: match[1], value }]
        : [];
    })
    .sort((left, right) => compareVersions(right.version, left.version));
  if (patched[0]) {
    return {
      value: patched[0].value,
      warnings: [`Selected ${patched[0].key}; Shale transport prompts were discarded.`],
    };
  }
  for (const key of ['systemPrompt', 'multipleSystemPrompt']) {
    const value = parsed[key];
    if (typeof value === 'string' && value.trim()) {
      return {
        value,
        warnings: [`Selected ${key}; Shale transport prompts were discarded.`],
      };
    }
  }
  throw new Error(`${sourceFile}: no supported system prompt.`);
}

function sanitizeInstruction(source) {
  const warnings = [];
  let instruction = source
    .replaceAll('{{to}}', '{{targetLanguage}}')
    .replaceAll('{{from}}', '{{sourceLanguage}}')
    .replace(/\{\{(?:title_prompt|summary_prompt|terms_prompt)\}\}/g, '');

  const variables = Array.from(instruction.matchAll(/\{\{([^{}]+)\}\}/g))
    .map((match) => match[1]);
  const unsupportedVariables = Array.from(new Set(variables.filter((variable) =>
    variable !== 'sourceLanguage' && variable !== 'targetLanguage')));
  if (unsupportedVariables.length) {
    warnings.push(`Removed unsupported variables: ${unsupportedVariables.join(', ')}`);
    instruction = instruction.replace(/\{\{([^{}]+)\}\}/g, (match, variable) =>
      variable === 'sourceLanguage' || variable === 'targetLanguage' ? match : '');
  }

  const transportPatterns = [
    /\boutput only\b/i,
    /\breturn only\b/i,
    /\bdo not include (?:explanations|additional content)\b/i,
    /\binput[- ]output format\b/i,
    /\byaml\b/i,
    /\bjson\b/i,
    /\bhtml tags?\b/i,
    /\btranslated content\b.*\bwithout explanations\b/i,
  ];
  const lines = instruction.split(/\r?\n/);
  const retainedLines = lines.filter((line) => {
    const isTransportLine = transportPatterns.some((pattern) => pattern.test(line));
    if (isTransportLine) warnings.push(`Removed upstream transport instruction: ${line.trim()}`);
    return !isTransportLine;
  });
  instruction = retainedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { instruction, warnings: Array.from(new Set(warnings)) };
}

function compareVersions(left, right) {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function requiredString(value, field) {
  const result = stringValue(value);
  if (!result) throw new Error(`${field} must be a non-empty string.`);
  return result;
}

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
