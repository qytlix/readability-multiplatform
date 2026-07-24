import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const CATALOG_URL =
  'https://assets.immersivetranslate.cn/static/terms/meta/index.json';
const TERMS_BASE_URL =
  'https://assets.immersivetranslate.cn/static/terms/glossaries/';
const EXPECTED_CATALOG_SHA256 =
  '69a53b41d883a3ed3016706ad65252c5bfe1275f2c1c2ec0aa1627da0dca4ed6';
const EXPECTED_LIBRARY_COUNT = 34;
const FORMAT_VERSION = 2;
const SUPPORTED_TARGETS = new Set([
  'zh-CN',
  'zh-TW',
  'zh-HK',
  'ja',
  'ko',
  'de',
  'fr',
  'es',
  'en',
]);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(projectRoot, args.input);
const outputPath = path.resolve(projectRoot, args.output);
const buildingPath = `${outputPath}.building-${process.pid}`;
const manifestPath = `${outputPath}.manifest.json`;
const sourceDatabaseSha256 = sha256(readFileSync(inputPath));

if (!outputPath.startsWith(`${path.join(projectRoot, 'resources')}${path.sep}`)) {
  throw new Error('The terminology library output must stay under resources/.');
}
mkdirSync(path.dirname(outputPath), { recursive: true });
rmSync(buildingPath, { force: true });
copyFileSync(inputPath, buildingPath);

try {
  const catalogBytes = await fetchBytes(CATALOG_URL);
  const catalogHash = sha256(catalogBytes);
  if (catalogHash !== EXPECTED_CATALOG_SHA256) {
    throw new Error(
      `Terminology catalog hash changed: expected ${EXPECTED_CATALOG_SHA256}, received ${catalogHash}.`,
    );
  }
  const catalog = JSON.parse(new TextDecoder().decode(catalogBytes));
  if (!Array.isArray(catalog) || catalog.length !== EXPECTED_LIBRARY_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_LIBRARY_COUNT} terminology libraries, received ${catalog?.length ?? 'invalid catalog'}.`,
    );
  }

  const compiled = await mapLimit(catalog, 6, async (metadata, sourceOrder) =>
    compileLibrary(metadata, sourceOrder));
  const db = new DatabaseSync(buildingPath);
  db.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;

    DROP TABLE IF EXISTS terminology_library_entry;
    DROP TABLE IF EXISTS terminology_library;

    CREATE TABLE terminology_library (
      id                              TEXT PRIMARY KEY,
      upstreamId                      TEXT NOT NULL UNIQUE,
      name                            TEXT NOT NULL,
      description                     TEXT NOT NULL,
      author                          TEXT NOT NULL,
      version                         TEXT NOT NULL,
      contentHash                     TEXT NOT NULL,
      entryCount                      INTEGER NOT NULL CHECK (entryCount >= 0),
      availableTargetLanguagesJson    TEXT NOT NULL,
      usesTraditionalChineseFallback  INTEGER NOT NULL CHECK (
        usesTraditionalChineseFallback IN (0, 1)
      ),
      catalogUrl                      TEXT NOT NULL,
      catalogHash                     TEXT NOT NULL,
      sourceOrder                     INTEGER NOT NULL
    );

    CREATE TABLE terminology_library_entry (
      libraryId       TEXT NOT NULL
        REFERENCES terminology_library(id) ON DELETE CASCADE,
      sourceOrder     INTEGER NOT NULL,
      source          TEXT NOT NULL,
      normalizedSource TEXT NOT NULL,
      target          TEXT,
      targetLanguage  TEXT CHECK (
        targetLanguage IS NULL OR targetLanguage IN (
          'zh-CN', 'zh-HK', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es', 'en'
        )
      ),
      provenanceFile  TEXT NOT NULL,
      PRIMARY KEY (libraryId, sourceOrder)
    );

    CREATE INDEX idx_terminology_library_entry_lookup
      ON terminology_library_entry(
        normalizedSource, targetLanguage, libraryId
      );
  `);
  const insertLibrary = db.prepare(`
    INSERT INTO terminology_library (
      id, upstreamId, name, description, author, version, contentHash,
      entryCount, availableTargetLanguagesJson,
      usesTraditionalChineseFallback, catalogUrl, catalogHash, sourceOrder
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEntry = db.prepare(`
    INSERT INTO terminology_library_entry (
      libraryId, sourceOrder, source, normalizedSource, target,
      targetLanguage, provenanceFile
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const library of compiled) {
      insertLibrary.run(
        library.id,
        library.upstreamId,
        library.name,
        library.description,
        library.author,
        library.version,
        library.contentHash,
        library.entries.length,
        JSON.stringify(library.availableTargetLanguages),
        library.usesTraditionalChineseFallback ? 1 : 0,
        CATALOG_URL,
        catalogHash,
        library.sourceOrder,
      );
      library.entries.forEach((entry, index) => {
        insertEntry.run(
          library.id,
          index,
          entry.source,
          entry.normalizedSource,
          entry.target ?? null,
          entry.targetLanguage ?? null,
          entry.provenanceFile,
        );
      });
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const agrovocCount = db.prepare(`
    SELECT COUNT(*) AS count FROM terminology_concept
  `).get().count;
  db.exec('PRAGMA optimize; VACUUM;');
  db.close();

  rmSync(outputPath, { force: true });
  renameSync(buildingPath, outputPath);
  const packHash = sha256(readFileSync(outputPath));
  const generatedAt = new Date().toISOString();
  writeFileSync(manifestPath, `${JSON.stringify({
    formatVersion: FORMAT_VERSION,
    generatedAt,
    sha256: packHash,
    catalog: {
      url: CATALOG_URL,
      sha256: catalogHash,
      expectedLibraryCount: EXPECTED_LIBRARY_COUNT,
    },
    agrovoc: {
      sourceDatabaseSha256,
      conceptCount: Number(agrovocCount),
      mergedInto: 'builtin:default',
    },
    libraries: compiled.map(({ entries, ...library }) => ({
      ...library,
      entryCount: entries.length,
    })),
  }, null, 2)}\n`, 'utf8');

  console.log(
    `Built ${compiled.length} terminology libraries with ${
      compiled.reduce((total, library) => total + library.entries.length, 0)
    } normalized entries.`,
  );
  console.log(`SHA-256 ${packHash}`);
} catch (error) {
  rmSync(buildingPath, { force: true });
  throw error;
}

async function compileLibrary(metadata, sourceOrder) {
  validateMetadata(metadata);
  const fileResults = await Promise.all(metadata.langs.map(async (language) => {
    const fileName = language === 'auto'
      ? `${metadata.glossary}.csv`
      : `${metadata.glossary}_${language}.csv`;
    const url = `${TERMS_BASE_URL}${fileName}`;
    const bytes = await fetchBytes(url);
    const fileHash = sha256(bytes);
    const expectedHash = metadata.langsHash?.[language];
    if (!expectedHash || fileHash !== expectedHash) {
      throw new Error(
        `${metadata.id}/${language} hash mismatch: expected ${expectedHash}, received ${fileHash}.`,
      );
    }
    const parsed = parseUpstreamCsv(
      new TextDecoder().decode(bytes).replace(/^\uFEFF/, ''),
      language,
      fileName,
    );
    return {
      targetLanguage: language,
      url,
      langsHash: expectedHash,
      sha256: fileHash,
      entryCount: parsed.entries.length,
      warnings: parsed.warnings,
      entries: parsed.entries,
    };
  }));
  const entries = [];
  const firstByIdentity = new Map();
  const warnings = [];
  for (const file of fileResults) {
    warnings.push(...file.warnings);
    for (const entry of file.entries) {
      const identity = `${entry.normalizedSource}\u0000${entry.targetLanguage ?? ''}`;
      const existing = firstByIdentity.get(identity);
      if (existing) {
        warnings.push({
          file: entry.provenanceFile,
          line: entry.sourceLine,
          message: existing.target === entry.target
            ? 'Duplicate entry ignored.'
            : 'Conflicting entry ignored; the first catalog entry wins.',
        });
        continue;
      }
      firstByIdentity.set(identity, entry);
      entries.push(entry);
    }
  }
  const contentHash = sha256(Buffer.from(JSON.stringify(entries.map((entry) => ({
    source: entry.source,
    target: entry.target,
    targetLanguage: entry.targetLanguage,
  })))));
  return {
    id: metadata.id === 'default'
      ? 'builtin:default'
      : `builtin:${metadata.id}`,
    upstreamId: metadata.id,
    name: String(metadata.name),
    description: String(metadata.description ?? ''),
    author: String(metadata.author ?? 'Unknown'),
    version: `catalog@${contentHash.slice(0, 12)}`,
    contentHash,
    availableTargetLanguages: metadata.langs.map((language) =>
      language === 'auto' ? 'all' : language),
    usesTraditionalChineseFallback: metadata.langs.includes('zh-TW'),
    sourceOrder,
    files: fileResults.map(({ entries: _entries, ...file }) => file),
    warnings,
    entries,
  };
}

function parseUpstreamCsv(input, fileLanguage, fileName) {
  let rows;
  try {
    rows = parseCsv(input);
  } catch (error) {
    throw new Error(`${fileName}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const header = rows.shift();
  if (
    !header
    || header.fields.length !== 3
    || header.fields.join(',') !== 'source,target,tgt_lng'
  ) {
    throw new Error(`${fileName} does not use source,target,tgt_lng.`);
  }
  const warnings = [];
  const entries = [];
  for (const row of rows) {
    if (row.fields.length === 1 && row.fields[0] === '') continue;
    if (row.fields.length > 3 && row.fields.slice(3).every((field) => !field)) {
      warnings.push({
        file: fileName,
        line: row.line,
        message: 'Trailing empty CSV fields were discarded.',
      });
      row.fields = row.fields.slice(0, 3);
    }
    if (row.fields.length === 2) {
      warnings.push({
        file: fileName,
        line: row.line,
        message: 'Missing optional tgt_lng field was normalized to empty.',
      });
      row.fields.push('');
    }
    if (row.fields.length !== 3) {
      throw new Error(`${fileName}:${row.line} must contain exactly three fields.`);
    }
    const source = row.fields[0].normalize('NFC').trim();
    const target = row.fields[1].normalize('NFC').trim();
    const declaredLanguage = row.fields[2].trim();
    const targetLanguage = declaredLanguage
      || (fileLanguage === 'auto' ? undefined : fileLanguage);
    if (!source) {
      warnings.push({
        file: fileName,
        line: row.line,
        message: 'Empty source entry ignored.',
      });
      continue;
    }
    if (targetLanguage && !SUPPORTED_TARGETS.has(targetLanguage)) {
      throw new Error(
        `${fileName}:${row.line} uses unsupported target language ${targetLanguage}.`,
      );
    }
    entries.push({
      source,
      normalizedSource: normalizeSource(source),
      target: target || undefined,
      targetLanguage,
      provenanceFile: fileName,
      sourceLine: row.line,
    });
  }
  return { entries, warnings };
}

function parseCsv(input) {
  const rows = [];
  let fields = [];
  let field = '';
  let line = 1;
  let rowLine = 1;
  let index = 0;
  let quoted = false;
  let closedQuote = false;
  const finishField = () => {
    fields.push(field);
    field = '';
    closedQuote = false;
  };
  const finishRow = () => {
    finishField();
    rows.push({ line: rowLine, fields });
    fields = [];
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
    if (closedQuote && ![',', '\r', '\n'].includes(character)) {
      throw new Error(`Malformed CSV at line ${line}: text after closing quote.`);
    }
    if (character === '"' && !field) {
      quoted = true;
      index += 1;
      continue;
    }
    if (character === '"') {
      // Pinned upstream files contain a few unquoted product names such as
      // AX/LAS-5 "Guard Dog" Rover. Treat these quote characters literally
      // during build-time normalization; user imports remain strict RFC 4180.
      field += character;
      index += 1;
      continue;
    }
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
  if (quoted) throw new Error(`Malformed CSV at line ${line}: unclosed quote.`);
  if (field || fields.length) finishRow();
  return rows;
}

function validateMetadata(metadata) {
  if (
    !metadata
    || typeof metadata.id !== 'string'
    || typeof metadata.name !== 'string'
    || typeof metadata.glossary !== 'string'
    || !Array.isArray(metadata.langs)
    || !metadata.langs.length
  ) {
    throw new Error('The terminology catalog contains invalid metadata.');
  }
}

async function fetchBytes(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json,text/csv;q=0.9,*/*;q=0.8',
      'User-Agent':
        'Shale terminology library builder (https://github.com/qytlix/readability-multiplatform)',
    },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

async function mapLimit(values, limit, callback) {
  const results = new Array(values.length);
  let nextIndex = 0;
  await Promise.all(Array.from(
    { length: Math.min(limit, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await callback(values[index], index);
      }
    },
  ));
  return results;
}

function normalizeSource(value) {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv) {
  const parsed = {
    input: 'resources/terminology/terminology.sqlite',
    output: 'resources/terminology/terminology-libraries.sqlite',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === '--input' && value) parsed.input = value;
    if (name === '--output' && value) parsed.output = value;
    if (name?.startsWith('--')) index += 1;
  }
  return parsed;
}
