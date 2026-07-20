import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const AGROVOC_DOWNLOAD_URL = 'https://agrovoc.fao.org/latestAgrovoc/agrovoc_core.nt.zip';
const CORE_LABEL_PATTERN = /^<([^>]+)> <http:\/\/www\.w3\.org\/2004\/02\/skos\/core#(pref|alt)Label> "((?:[^"\\]|\\.)*)"@(en|zh(?:-[A-Za-z]+)?) \.$/;
const XL_LABEL_PATTERN = /^<([^>]+)> <http:\/\/www\.w3\.org\/2008\/05\/skos-xl#(pref|alt)Label> <([^>]+)> \.$/;
const XL_LITERAL_PATTERN = /^<([^>]+)> <http:\/\/www\.w3\.org\/2008\/05\/skos-xl#literalForm> "((?:[^"\\]|\\.)*)"@(en|zh(?:-[A-Za-z]+)?) \.$/;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const outputPath = path.resolve(projectRoot, args.output);
const manifestPath = `${outputPath}.manifest.json`;
const buildingPath = `${outputPath}.building-${process.pid}`;

mkdirSync(path.dirname(outputPath), { recursive: true });
rmSync(buildingPath, { force: true });

const { records, sourceHash, sourceVersion } = await downloadAgrovoc(args.maxRecords, args.version);
if (records.length === 0) throw new Error('The AGROVOC dump contained no English-Chinese term pairs.');

const db = new DatabaseSync(buildingPath);
db.exec(`
  PRAGMA journal_mode = DELETE;
  PRAGMA synchronous = FULL;

  CREATE TABLE terminology_source (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    version     TEXT NOT NULL,
    license     TEXT NOT NULL,
    attribution TEXT NOT NULL,
    sourceUrl   TEXT NOT NULL,
    sourceHash  TEXT NOT NULL,
    generatedAt TEXT NOT NULL
  );

  CREATE TABLE terminology_concept (
    sourceId    TEXT NOT NULL REFERENCES terminology_source(id),
    conceptId   TEXT NOT NULL,
    definition  TEXT,
    domain      TEXT,
    reliability REAL,
    PRIMARY KEY (sourceId, conceptId)
  );

  CREATE TABLE terminology_term (
    sourceId       TEXT NOT NULL,
    conceptId      TEXT NOT NULL,
    language       TEXT NOT NULL CHECK (language IN ('en', 'zh')),
    term           TEXT NOT NULL,
    normalizedTerm TEXT NOT NULL,
    isPreferred    INTEGER NOT NULL CHECK (isPreferred IN (0, 1)),
    FOREIGN KEY (sourceId, conceptId)
      REFERENCES terminology_concept(sourceId, conceptId)
  );

  CREATE INDEX idx_terminology_term_lookup
    ON terminology_term(language, normalizedTerm);
  CREATE INDEX idx_terminology_term_concept
    ON terminology_term(sourceId, conceptId, language, isPreferred);

  CREATE VIRTUAL TABLE terminology_fts USING fts5(
    sourceId UNINDEXED,
    conceptId UNINDEXED,
    language UNINDEXED,
    term,
    tokenize = 'unicode61 remove_diacritics 2'
  );
`);

const generatedAt = new Date().toISOString();
db.prepare(`
  INSERT INTO terminology_source
    (id, name, version, license, attribution, sourceUrl, sourceHash, generatedAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  'agrovoc',
  'FAO AGROVOC',
  sourceVersion,
  'CC BY 4.0',
  'Food and Agriculture Organization of the United Nations (FAO), AGROVOC',
  AGROVOC_DOWNLOAD_URL,
  sourceHash,
  generatedAt,
);

const insertConcept = db.prepare(`
  INSERT OR IGNORE INTO terminology_concept
    (sourceId, conceptId, definition, domain, reliability)
  VALUES ('agrovoc', ?, NULL, 'agriculture-food-environment', 1.0)
`);
const insertTerm = db.prepare(`
  INSERT INTO terminology_term
    (sourceId, conceptId, language, term, normalizedTerm, isPreferred)
  VALUES ('agrovoc', ?, ?, ?, ?, ?)
`);
const insertFts = db.prepare(`
  INSERT INTO terminology_fts (sourceId, conceptId, language, term)
  VALUES ('agrovoc', ?, ?, ?)
`);

db.exec('BEGIN IMMEDIATE');
try {
  for (const record of records) {
    insertConcept.run(record.conceptId);
    for (const language of ['en', 'zh']) {
      const preferredTerm = record[language];
      insertTerm.run(record.conceptId, language, preferredTerm, normalizeTerm(preferredTerm, language), 1);
      insertFts.run(record.conceptId, language, preferredTerm);
      for (const alias of record.aliases[language]) {
        insertTerm.run(record.conceptId, language, alias, normalizeTerm(alias, language), 0);
        insertFts.run(record.conceptId, language, alias);
      }
    }
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

db.exec('PRAGMA optimize; VACUUM;');
db.close();

rmSync(outputPath, { force: true });
renameSync(buildingPath, outputPath);
const packHash = createHash('sha256').update(readFileSync(outputPath)).digest('hex');
writeFileSync(manifestPath, `${JSON.stringify({
  formatVersion: 1,
  packVersion: `agrovoc@${sourceVersion}`,
  generatedAt,
  recordCount: records.length,
  sha256: packHash,
  sources: [{
    id: 'agrovoc',
    name: 'FAO AGROVOC',
    license: 'CC BY 4.0',
    url: AGROVOC_DOWNLOAD_URL,
  }],
}, null, 2)}\n`, 'utf8');

console.log(`Built ${records.length} bilingual terms at ${outputPath}`);
console.log(`SHA-256 ${packHash}`);

async function downloadAgrovoc(maxRecords, requestedVersion) {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), 'shale-agrovoc-'));
  const archivePath = path.join(workingDirectory, 'agrovoc_core.nt.zip');
  try {
    const response = await fetch(AGROVOC_DOWNLOAD_URL, {
      headers: {
        Accept: 'application/zip',
        'User-Agent': 'Shale terminology pack builder (https://github.com/qytlix/readability-multiplatform)',
      },
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok || !response.body) {
      throw new Error(`AGROVOC download failed with HTTP ${response.status}.`);
    }
    await pipeline(response.body, createWriteStream(archivePath));
    execFileSync('tar', ['-xf', archivePath, '-C', workingDirectory], { stdio: 'inherit' });

    const ntPath = findFile(workingDirectory, '.nt');
    if (!ntPath) throw new Error('The AGROVOC archive did not contain an N-Triples file.');

    const labels = new Map();
    const labelConcepts = new Map();
    const labelLiterals = new Map();
    const input = createInterface({ input: createReadStream(ntPath, 'utf8'), crlfDelay: Infinity });
    for await (const line of input) {
      const match = CORE_LABEL_PATTERN.exec(line);
      if (match) {
        addLabel(labels, match[1], match[4], decodeNTriplesString(match[3]), match[2] === 'pref');
        continue;
      }
      const labelReference = XL_LABEL_PATTERN.exec(line);
      if (labelReference && /\/xl_(?:en|zh)(?:_|-)/.test(labelReference[3])) {
        labelConcepts.set(labelReference[3], {
          conceptId: labelReference[1],
          isPreferred: labelReference[2] === 'pref',
        });
        continue;
      }
      const literal = XL_LITERAL_PATTERN.exec(line);
      if (literal) labelLiterals.set(literal[1], { language: literal[3], term: decodeNTriplesString(literal[2]) });
    }
    for (const [labelId, reference] of labelConcepts) {
      const literal = labelLiterals.get(labelId);
      if (literal) {
        addLabel(labels, reference.conceptId, literal.language, literal.term, reference.isPreferred);
      }
    }

    const records = [...labels.entries()]
      .filter(([, value]) => value.en && value.zh)
      .map(([conceptId, value]) => ({
        conceptId,
        en: value.en,
        zh: value.zh,
        aliases: {
          en: [...value.aliases.en].filter((term) => term !== value.en),
          zh: [...value.aliases.zh].filter((term) => term !== value.zh),
        },
      }))
      .sort((left, right) => left.conceptId.localeCompare(right.conceptId))
      .slice(0, maxRecords ?? labels.size);
    const modified = response.headers.get('last-modified');
    const sourceVersion = requestedVersion
      ?? (modified ? new Date(modified).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
    const sourceHash = await hashFile(archivePath);
    console.log(`Parsed ${records.length} bilingual concepts from the AGROVOC Core dump.`);
    return { records, sourceHash, sourceVersion };
  } finally {
    const resolvedWorkingDirectory = path.resolve(workingDirectory);
    const resolvedTemporaryRoot = `${path.resolve(tmpdir())}${path.sep}`;
    if (!resolvedWorkingDirectory.startsWith(resolvedTemporaryRoot)) {
      throw new Error(`Refusing to remove a non-temporary directory: ${resolvedWorkingDirectory}`);
    }
    rmSync(resolvedWorkingDirectory, { recursive: true, force: true });
  }
}

function addLabel(labels, conceptId, languageTag, value, isPreferred) {
  const term = value.trim();
  if (!term) return;
  const language = languageTag.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  const concept = labels.get(conceptId) ?? {
    aliases: { en: new Set(), zh: new Set() },
  };
  if (isPreferred) {
    if (!concept[language] || languageTag === language) concept[language] = term;
  } else {
    concept.aliases[language].add(term);
  }
  labels.set(conceptId, concept);
}

function findFile(directory, extension) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(entryPath, extension);
      if (nested) return nested;
    } else if (entry.name.toLowerCase().endsWith(extension)) {
      return entryPath;
    }
  }
  return undefined;
}

function decodeNTriplesString(value) {
  return value
    .replace(/\\U([0-9a-fA-F]{8})/g, (_, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, codePoint) => String.fromCharCode(Number.parseInt(codePoint, 16)))
    .replace(/\\(["\\tnrbf])/g, (_, escaped) => ({
      '"': '"',
      '\\': '\\',
      t: '\t',
      n: '\n',
      r: '\r',
      b: '\b',
      f: '\f',
    })[escaped]);
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function normalizeTerm(value, language) {
  const normalized = value.normalize('NFKC').trim();
  return language === 'en'
    ? normalized.toLocaleLowerCase('en-US').replace(/\s+/g, ' ')
    : normalized.replace(/\s+/g, '');
}

function parseArgs(argv) {
  const parsed = {
    output: 'resources/terminology/terminology.sqlite',
    version: undefined,
    maxRecords: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === '--output' && value) parsed.output = value;
    if (name === '--version' && value) parsed.version = value;
    if (name === '--max-records' && value) parsed.maxRecords = Number(value);
    if (name?.startsWith('--')) index += 1;
  }
  if (parsed.maxRecords !== undefined && (!Number.isInteger(parsed.maxRecords) || parsed.maxRecords <= 0)) {
    throw new Error('--max-records must be a positive integer.');
  }
  return parsed;
}
