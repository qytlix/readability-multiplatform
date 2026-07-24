import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type {
  TranslationTargetLanguage,
  TranslationTerminologyMatch,
  TerminologyPackInfo,
} from '../../../shared/contracts/translation.types';
import {
  DEFAULT_TERMINOLOGY_LIBRARY_ID,
  type TerminologyEntryTargetLanguage,
  type TerminologyImportPreview,
  type TerminologyImportRequest,
  type TerminologyLibrary,
  type TerminologyLibraryList,
  type TerminologyLibraryMutationResult,
} from '../../../shared/contracts/translation-terminology.types';
import {
  normalizeTerminologySource,
  previewTerminologyCsv,
} from '../terminology/TerminologyCsvParser';
import {
  TRANSLATION_ERROR_CODES,
  TranslationError,
} from '../../../shared/errors/translation.errors';

const MAX_CANDIDATES = 12;
const MAX_NGRAM_WORDS = 5;
const MAX_COMPACT_TERM_LENGTH = 16;
const MAX_PROBES = 2_000;
const MAX_FTS_TOKENS = 8;
const QUERY_PROBE_CHUNK_SIZE = 400;

interface SourceRow {
  id: string;
  name: string;
  version: string;
  license: string;
  attribution: string;
  sourceUrl: string;
}

interface LegacyTermRow {
  conceptId: string;
  sourceId: string;
  sourceTerm: string;
  targetTerm: string;
  definition: string | null;
  domain: string | null;
  reliability: number | null;
}

interface BuiltInLibraryRow {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  contentHash: string;
  entryCount: number;
  availableTargetLanguagesJson: string;
  usesTraditionalChineseFallback: number;
  sourceOrder: number;
}

interface UserLibraryRow {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  contentHash: string;
  entryCount: number;
  createdAt: string;
}

interface ConfigRow {
  libraryId: string;
  enabled: number;
  orderIndex: number;
}

interface ModernTermRow {
  entryId: string | number;
  libraryId: string;
  sourceTerm: string;
  normalizedSource: string;
  targetTerm: string | null;
  targetLanguage: TerminologyEntryTargetLanguage | null;
}

interface RankedMatch {
  match: TranslationTerminologyMatch;
  originRank: number;
  languageRank: number;
  libraryOrder: number;
  specificity: number;
}

export interface TerminologyLookup {
  getVersion(): string;
  getInfo(): TerminologyPackInfo;
  findCandidates(
    text: string,
    targetLanguage: TranslationTargetLanguage,
    version?: string,
  ): TranslationTerminologyMatch[];
  close?(): void;
}

export class TerminologyStore implements TerminologyLookup {
  private readonly bundledDb: Database.Database;
  private readonly legacySources: SourceRow[];
  private readonly legacyVersion: string;
  private readonly hasBundledLibraryTables: boolean;
  private readonly enabledSnapshots = new Map<string, TerminologyLibrary[]>();

  constructor(
    dbPath: string,
    private readonly appDb?: Database.Database,
  ) {
    this.bundledDb = new Database(dbPath, {
      readonly: true,
      fileMustExist: true,
    });
    this.legacySources = this.bundledDb.prepare(`
      SELECT id, name, version, license, attribution, sourceUrl
      FROM terminology_source ORDER BY id
    `).all() as SourceRow[];
    this.legacyVersion = this.legacySources.length
      ? this.legacySources.map((source) => `${source.id}@${source.version}`).join('+')
      : 'empty';
    this.hasBundledLibraryTables = Boolean(this.bundledDb.prepare(`
      SELECT 1
      FROM sqlite_master
      WHERE type = 'table' AND name = 'terminology_library'
    `).get());
  }

  getVersion(): string {
    return this.listLibraries().enabledSetHash;
  }

  getInfo(): TerminologyPackInfo {
    return {
      version: this.getVersion(),
      sources: this.legacySources,
    };
  }

  listLibraries(): TerminologyLibraryList {
    const config = this.getConfig();
    const builtIns = this.getBuiltInLibraries(config);
    const users = this.getUserLibraries(config, builtIns.length);
    const libraries = [...builtIns, ...users].sort(compareLibraries);
    const enabled = libraries
      .filter((library) => library.enabled)
      .map((library) => ({
        id: library.id,
        version: library.version,
        contentHash: library.contentHash,
      }));
    const enabledSetHash = enabled.length
      ? createHash('sha256').update(JSON.stringify(enabled)).digest('hex')
      : 'none';
    this.enabledSnapshots.set(
      enabledSetHash,
      libraries.filter((library) => library.enabled),
    );
    if (this.enabledSnapshots.size > 128) {
      const oldest = this.enabledSnapshots.keys().next().value;
      if (oldest) this.enabledSnapshots.delete(oldest);
    }
    return {
      libraries,
      enabledSetHash,
    };
  }

  setLibraryEnabled(
    id: string,
    enabled: boolean,
  ): TerminologyLibraryMutationResult {
    this.requireAppDb();
    const existing = this.listLibraries().libraries.find((library) => library.id === id);
    if (!existing) throw invalidTerminology(`Terminology library “${id}” does not exist.`);
    this.upsertConfig(id, enabled, existing.orderIndex);
    return { libraryId: id, enabledSetHash: this.getVersion() };
  }

  previewImport(name: string, csv: string): TerminologyImportPreview {
    const preview = previewTerminologyCsv(name, csv);
    if (!this.appDb || !preview.name) return preview;
    const existing = this.appDb.prepare(`
      SELECT id FROM terminology_library_user WHERE name = ? COLLATE NOCASE
    `).get(preview.name) as { id: string } | undefined;
    return existing
      ? {
          ...preview,
          replacesExistingUserLibrary: true,
          existingLibraryId: existing.id,
        }
      : preview;
  }

  importLibrary(
    request: TerminologyImportRequest,
  ): TerminologyLibraryMutationResult {
    const appDb = this.requireAppDb();
    const preview = this.previewImport(request.name, request.csv);
    if (!preview.valid || !preview.contentHash) {
      throw invalidTerminology('The terminology CSV contains validation errors.');
    }
    const contentHash = preview.contentHash;
    if (preview.replacesExistingUserLibrary && request.replace !== true) {
      throw invalidTerminology('A user terminology library with this name already exists.');
    }
    const libraryId = preview.existingLibraryId ?? `user:${randomUUID()}`;
    const now = new Date().toISOString();
    appDb.transaction(() => {
      if (preview.existingLibraryId) {
        appDb.prepare(`
          DELETE FROM terminology_entry_user WHERE libraryId = ?
        `).run(libraryId);
        appDb.prepare(`
          UPDATE terminology_library_user
          SET name = ?, version = ?, contentHash = ?, entryCount = ?, updatedAt = ?
          WHERE id = ?
        `).run(
          preview.name,
          `user@${contentHash.slice(0, 12)}`,
          contentHash,
          preview.acceptedRowCount,
          now,
          libraryId,
        );
      } else {
        appDb.prepare(`
          INSERT INTO terminology_library_user (
            id, name, description, author, version, contentHash,
            entryCount, createdAt, updatedAt
          ) VALUES (?, ?, '', 'User', ?, ?, ?, ?, ?)
        `).run(
          libraryId,
          preview.name,
          `user@${contentHash.slice(0, 12)}`,
          contentHash,
          preview.acceptedRowCount,
          now,
          now,
        );
      }
      const insert = appDb.prepare(`
        INSERT INTO terminology_entry_user (
          libraryId, source, normalizedSource, target, targetLanguage, sourceLine
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const entry of preview.entries) {
        insert.run(
          libraryId,
          entry.source,
          normalizeTerminologySource(entry.source),
          entry.target ?? null,
          entry.targetLanguage ?? null,
          entry.line,
        );
      }
      if (!preview.existingLibraryId) {
        const nextOrder = this.listLibraries().libraries.reduce(
          (maximum, library) => Math.max(maximum, library.orderIndex),
          -1,
        ) + 1;
        this.upsertConfig(libraryId, true, nextOrder);
      }
    })();
    return { libraryId, enabledSetHash: this.getVersion() };
  }

  removeLibrary(id: string): TerminologyLibraryMutationResult {
    const appDb = this.requireAppDb();
    if (!id.startsWith('user:')) {
      throw invalidTerminology('Built-in terminology libraries cannot be removed.');
    }
    const deleted = appDb.transaction(() => {
      const result = appDb.prepare(`
        DELETE FROM terminology_library_user WHERE id = ?
      `).run(id);
      appDb.prepare(`
        DELETE FROM terminology_library_config WHERE libraryId = ?
      `).run(id);
      return result.changes;
    })();
    if (!deleted) {
      throw invalidTerminology(`Terminology library “${id}” does not exist.`);
    }
    return { libraryId: id, enabledSetHash: this.getVersion() };
  }

  findCandidates(
    text: string,
    targetLanguage: TranslationTargetLanguage,
    version?: string,
  ): TranslationTerminologyMatch[] {
    const libraries = version
      ? this.enabledSnapshots.get(version) ?? []
      : this.listLibraries().libraries.filter((library) => library.enabled);
    if (!libraries.length) return [];
    const probes = buildProbes(text);
    if (!probes.length) return [];
    const order = new Map(libraries.map((library) => [
      library.id,
      library.orderIndex,
    ]));
    const userIds = libraries
      .filter((library) => library.origin === 'user')
      .map((library) => library.id);
    const builtInIds = libraries
      .filter((library) => library.origin === 'builtin')
      .map((library) => library.id);
    const ranked = [
      ...this.findModernCandidates(
        this.appDb,
        'terminology_entry_user',
        userIds,
        probes,
        targetLanguage,
        order,
        0,
      ),
      ...this.findModernCandidates(
        this.hasBundledLibraryTables ? this.bundledDb : undefined,
        'terminology_library_entry',
        builtInIds,
        probes,
        targetLanguage,
        order,
        1,
      ),
    ];
    if (builtInIds.includes(DEFAULT_TERMINOLOGY_LIBRARY_ID)) {
      ranked.push(...this.findLegacyCandidates(text, targetLanguage).map((match) => ({
        match,
        originRank: 1,
        languageRank: 0,
        libraryOrder: order.get(DEFAULT_TERMINOLOGY_LIBRARY_ID) ?? 0,
        specificity: normalizeTerminologySource(match.sourceTerm).length,
      })));
    }
    ranked.sort(compareRankedMatches);
    return deduplicate(ranked.map(({ match }) => match)).slice(0, MAX_CANDIDATES);
  }

  close(): void {
    this.enabledSnapshots.clear();
    this.bundledDb.close();
  }

  private getBuiltInLibraries(config: Map<string, ConfigRow>): TerminologyLibrary[] {
    const legacyContentHash = createHash('sha256')
      .update(this.legacyVersion)
      .digest('hex');
    if (!this.hasBundledLibraryTables) {
      const state = config.get(DEFAULT_TERMINOLOGY_LIBRARY_ID);
      return [{
        id: DEFAULT_TERMINOLOGY_LIBRARY_ID,
        name: 'Default',
        description: 'FAO AGROVOC English/Chinese terminology.',
        author: 'Shale / FAO',
        version: this.legacyVersion,
        origin: 'builtin',
        enabled: state ? Boolean(state.enabled) : true,
        orderIndex: state?.orderIndex ?? 0,
        entryCount: this.getLegacyEntryCount(),
        contentHash: legacyContentHash,
        availableTargetLanguages: ['zh-CN', 'en'],
        usesTraditionalChineseFallback: false,
        removable: false,
      }];
    }
    const rows = this.bundledDb.prepare(`
      SELECT id, name, description, author, version, contentHash, entryCount,
             availableTargetLanguagesJson, usesTraditionalChineseFallback,
             sourceOrder
      FROM terminology_library
      ORDER BY sourceOrder, id
    `).all() as BuiltInLibraryRow[];
    return rows.map((row) => {
      const state = config.get(row.id);
      const isDefault = row.id === DEFAULT_TERMINOLOGY_LIBRARY_ID;
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        author: row.author,
        version: isDefault ? `${this.legacyVersion}+${row.version}` : row.version,
        origin: 'builtin',
        enabled: state ? Boolean(state.enabled) : isDefault,
        orderIndex: state?.orderIndex ?? row.sourceOrder,
        entryCount: row.entryCount + (isDefault ? this.getLegacyEntryCount() : 0),
        contentHash: isDefault
          ? createHash('sha256')
            .update(`${legacyContentHash}:${row.contentHash}`)
            .digest('hex')
          : row.contentHash,
        availableTargetLanguages: parseTargetLanguages(
          row.availableTargetLanguagesJson,
        ),
        usesTraditionalChineseFallback:
          Boolean(row.usesTraditionalChineseFallback),
        removable: false,
      };
    });
  }

  private getUserLibraries(
    config: Map<string, ConfigRow>,
    firstOrder: number,
  ): TerminologyLibrary[] {
    if (!this.appDb) return [];
    const rows = this.appDb.prepare(`
      SELECT id, name, description, author, version, contentHash,
             entryCount, createdAt
      FROM terminology_library_user
      ORDER BY createdAt, id
    `).all() as UserLibraryRow[];
    return rows.map((row, index) => {
      const state = config.get(row.id);
      const targetRows = this.appDb?.prepare(`
        SELECT DISTINCT targetLanguage
        FROM terminology_entry_user
        WHERE libraryId = ?
        ORDER BY targetLanguage
      `).all(row.id) as Array<{ targetLanguage: TranslationTargetLanguage | null }>;
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        author: row.author,
        version: row.version,
        origin: 'user',
        enabled: state ? Boolean(state.enabled) : true,
        orderIndex: state?.orderIndex ?? firstOrder + index,
        entryCount: row.entryCount,
        contentHash: row.contentHash,
        availableTargetLanguages: targetRows.map(({ targetLanguage }) =>
          targetLanguage ?? 'all'),
        usesTraditionalChineseFallback: false,
        removable: true,
      };
    });
  }

  private getConfig(): Map<string, ConfigRow> {
    if (!this.appDb) return new Map();
    const rows = this.appDb.prepare(`
      SELECT libraryId, enabled, orderIndex
      FROM terminology_library_config
    `).all() as ConfigRow[];
    return new Map(rows.map((row) => [row.libraryId, row]));
  }

  private upsertConfig(
    libraryId: string,
    enabled: boolean,
    orderIndex: number,
  ): void {
    this.requireAppDb().prepare(`
      INSERT INTO terminology_library_config (
        libraryId, enabled, orderIndex, updatedAt
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(libraryId) DO UPDATE SET
        enabled = excluded.enabled,
        orderIndex = excluded.orderIndex,
        updatedAt = excluded.updatedAt
    `).run(libraryId, enabled ? 1 : 0, orderIndex, new Date().toISOString());
  }

  private findModernCandidates(
    db: Database.Database | undefined,
    table: 'terminology_entry_user' | 'terminology_library_entry',
    libraryIds: string[],
    probes: string[],
    targetLanguage: TranslationTargetLanguage,
    order: Map<string, number>,
    originRank: number,
  ): RankedMatch[] {
    if (!db || !libraryIds.length) return [];
    const libraryPlaceholders = libraryIds.map(() => '?').join(', ');
    const rows: ModernTermRow[] = [];
    for (let offset = 0; offset < probes.length; offset += QUERY_PROBE_CHUNK_SIZE) {
      const chunk = probes.slice(offset, offset + QUERY_PROBE_CHUNK_SIZE);
      const probePlaceholders = chunk.map(() => '?').join(', ');
      const entryIdentity = table === 'terminology_entry_user'
        ? 'id'
        : 'sourceOrder';
      rows.push(...db.prepare(`
        SELECT ${entryIdentity} AS entryId, libraryId, source AS sourceTerm,
               normalizedSource, target AS targetTerm, targetLanguage
        FROM ${table}
        WHERE libraryId IN (${libraryPlaceholders})
          AND normalizedSource IN (${probePlaceholders})
          AND (
            targetLanguage = ?
            OR targetLanguage IS NULL
            OR (? = 'zh-HK' AND targetLanguage = 'zh-TW')
          )
      `).all(
        ...libraryIds,
        ...chunk,
        targetLanguage,
        targetLanguage,
      ) as ModernTermRow[]);
    }
    return rows.map((row) => ({
      match: {
        conceptId: `${row.libraryId}:${row.entryId}`,
        sourceId: row.libraryId,
        libraryId: row.libraryId,
        sourceTerm: row.sourceTerm,
        targetTerm: row.targetTerm || row.sourceTerm,
        ...(row.targetLanguage === 'zh-TW'
          ? { provenanceTargetLanguage: 'zh-TW' as const }
          : {}),
      },
      originRank,
      languageRank: row.targetLanguage === targetLanguage
        ? 0
        : row.targetLanguage === null
          ? 1
          : 2,
      libraryOrder: order.get(row.libraryId) ?? Number.MAX_SAFE_INTEGER,
      specificity: row.normalizedSource.length,
    }));
  }

  private findLegacyCandidates(
    text: string,
    targetLanguage: TranslationTargetLanguage,
  ): TranslationTerminologyMatch[] {
    if (targetLanguage !== 'zh-CN' && targetLanguage !== 'en') return [];
    const sourceLanguage = targetLanguage === 'zh-CN' ? 'en' : 'zh';
    const targetTermLanguage = targetLanguage === 'zh-CN' ? 'zh' : 'en';
    const probes = sourceLanguage === 'zh'
      ? buildCompactProbes(text)
      : buildWordProbes(text);
    if (!probes.length) return [];
    const exactRows: LegacyTermRow[] = [];
    for (let offset = 0; offset < probes.length; offset += QUERY_PROBE_CHUNK_SIZE) {
      const chunk = probes.slice(offset, offset + QUERY_PROBE_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(', ');
      exactRows.push(...this.bundledDb.prepare(`
        SELECT sourceTerm.conceptId, sourceTerm.sourceId,
               sourceTerm.term AS sourceTerm, targetTerm.term AS targetTerm,
               concept.definition, concept.domain, concept.reliability
        FROM terminology_term AS sourceTerm
        JOIN terminology_term AS targetTerm
          ON targetTerm.sourceId = sourceTerm.sourceId
         AND targetTerm.conceptId = sourceTerm.conceptId
         AND targetTerm.language = ?
         AND targetTerm.isPreferred = 1
        JOIN terminology_concept AS concept
          ON concept.sourceId = sourceTerm.sourceId
         AND concept.conceptId = sourceTerm.conceptId
        WHERE sourceTerm.language = ?
          AND sourceTerm.normalizedTerm IN (${placeholders})
        ORDER BY length(sourceTerm.term) DESC, concept.reliability DESC
        LIMIT ?
      `).all(
        targetTermLanguage,
        sourceLanguage,
        ...chunk,
        MAX_CANDIDATES,
      ) as LegacyTermRow[]);
    }
    const exactMatches = deduplicate(exactRows.map(toLegacyMatch));
    const ftsQuery = buildFtsQuery(text, sourceLanguage);
    if (exactMatches.length >= MAX_CANDIDATES || !ftsQuery) {
      return exactMatches.slice(0, MAX_CANDIDATES);
    }
    const ftsRows = this.bundledDb.prepare(`
      SELECT sourceTerm.conceptId, sourceTerm.sourceId,
             sourceTerm.term AS sourceTerm, targetTerm.term AS targetTerm,
             concept.definition, concept.domain, concept.reliability
      FROM terminology_fts
      JOIN terminology_term AS sourceTerm
        ON sourceTerm.sourceId = terminology_fts.sourceId
       AND sourceTerm.conceptId = terminology_fts.conceptId
       AND sourceTerm.language = terminology_fts.language
       AND sourceTerm.term = terminology_fts.term
      JOIN terminology_term AS targetTerm
        ON targetTerm.sourceId = sourceTerm.sourceId
       AND targetTerm.conceptId = sourceTerm.conceptId
       AND targetTerm.language = ?
       AND targetTerm.isPreferred = 1
      JOIN terminology_concept AS concept
        ON concept.sourceId = sourceTerm.sourceId
       AND concept.conceptId = sourceTerm.conceptId
      WHERE terminology_fts MATCH ?
        AND terminology_fts.language = ?
      ORDER BY bm25(terminology_fts), length(sourceTerm.term) DESC
      LIMIT ?
    `).all(
      targetTermLanguage,
      ftsQuery,
      sourceLanguage,
      MAX_CANDIDATES - exactMatches.length,
    ) as LegacyTermRow[];
    return deduplicate([...exactMatches, ...ftsRows.map(toLegacyMatch)])
      .slice(0, MAX_CANDIDATES);
  }

  private getLegacyEntryCount(): number {
    const row = this.bundledDb.prepare(`
      SELECT COUNT(*) AS count FROM terminology_concept
    `).get() as { count: number };
    return row.count;
  }

  private requireAppDb(): Database.Database {
    if (!this.appDb) {
      throw new TranslationError(
        TRANSLATION_ERROR_CODES.TRANSLATION_TERMINOLOGY_UNAVAILABLE,
        'The user terminology database is unavailable.',
        false,
      );
    }
    return this.appDb;
  }
}

export class EmptyTerminologyLookup implements TerminologyLookup {
  getVersion(): string {
    return 'none';
  }

  getInfo(): TerminologyPackInfo {
    return { version: 'none', sources: [] };
  }

  findCandidates(): TranslationTerminologyMatch[] {
    return [];
  }
}

function buildProbes(text: string): string[] {
  return [...new Set([
    ...buildWordProbes(text),
    ...buildCompactProbes(text),
  ])].slice(0, MAX_PROBES);
}

function buildWordProbes(text: string): string[] {
  const words = text
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const probes = new Set<string>();
  for (let start = 0; start < words.length; start += 1) {
    for (
      let length = 1;
      length <= MAX_NGRAM_WORDS && start + length <= words.length;
      length += 1
    ) {
      probes.add(words.slice(start, start + length).join(' '));
    }
  }
  return Array.from(probes).slice(0, MAX_PROBES);
}

function buildCompactProbes(text: string): string[] {
  const runs = text
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? [];
  const probes = new Set<string>();
  for (const run of runs) {
    for (let start = 0; start < run.length; start += 1) {
      for (
        let length = 2;
        length <= MAX_COMPACT_TERM_LENGTH && start + length <= run.length;
        length += 1
      ) {
        probes.add(run.slice(start, start + length));
        if (probes.size >= MAX_PROBES) return Array.from(probes);
      }
    }
  }
  return Array.from(probes);
}

function buildFtsQuery(text: string, language: 'en' | 'zh'): string | undefined {
  if (language === 'zh') return undefined;
  const tokens = text
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  const uniqueTokens = [...new Set(tokens)]
    .sort((left, right) => right.length - left.length)
    .slice(0, MAX_FTS_TOKENS);
  return uniqueTokens.length
    ? uniqueTokens.map((token) => `"${token}"`).join(' OR ')
    : undefined;
}

function toLegacyMatch(row: LegacyTermRow): TranslationTerminologyMatch {
  return {
    conceptId: row.conceptId,
    sourceId: `${DEFAULT_TERMINOLOGY_LIBRARY_ID}/${row.sourceId}`,
    libraryId: DEFAULT_TERMINOLOGY_LIBRARY_ID,
    sourceTerm: row.sourceTerm,
    targetTerm: row.targetTerm,
    definition: row.definition ?? undefined,
    domain: row.domain ?? undefined,
    reliability: row.reliability ?? undefined,
  };
}

function compareLibraries(left: TerminologyLibrary, right: TerminologyLibrary): number {
  return left.orderIndex - right.orderIndex || left.id.localeCompare(right.id);
}

function compareRankedMatches(left: RankedMatch, right: RankedMatch): number {
  return left.originRank - right.originRank
    || left.languageRank - right.languageRank
    || left.libraryOrder - right.libraryOrder
    || right.specificity - left.specificity
    || left.match.sourceTerm.localeCompare(right.match.sourceTerm)
    || left.match.targetTerm.localeCompare(right.match.targetTerm);
}

function deduplicate(
  matches: TranslationTerminologyMatch[],
): TranslationTerminologyMatch[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = `${normalizeTerminologySource(match.sourceTerm)}:${match.targetTerm}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseTargetLanguages(
  value: string,
): TerminologyLibrary['availableTargetLanguages'] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((language): language is TerminologyLibrary['availableTargetLanguages'][number] =>
        language === 'all'
        || language === 'zh-TW'
        || [
          'zh-CN', 'zh-HK', 'ja', 'ko', 'de', 'fr', 'es', 'en',
        ].includes(String(language)))
      : [];
  } catch {
    return [];
  }
}

function invalidTerminology(message: string): TranslationError {
  return new TranslationError(
    TRANSLATION_ERROR_CODES.TRANSLATION_TERMINOLOGY_INVALID,
    message,
    false,
  );
}
