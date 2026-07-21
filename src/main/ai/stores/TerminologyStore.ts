import Database from 'better-sqlite3';
import type {
  TranslationTargetLanguage,
  TranslationTerminologyMatch,
  TerminologyPackInfo,
} from '../../../shared/contracts/translation.types';

const MAX_CANDIDATES = 12;
const MAX_NGRAM_WORDS = 5;
const MAX_CHINESE_TERM_LENGTH = 8;
const MAX_PROBES = 5_000;
const MAX_FTS_TOKENS = 8;

interface SourceRow {
  id: string;
  name: string;
  version: string;
  license: string;
  attribution: string;
  sourceUrl: string;
}

interface TermRow {
  conceptId: string;
  sourceId: string;
  sourceTerm: string;
  targetTerm: string;
  definition: string | null;
  domain: string | null;
  reliability: number | null;
}

export interface TerminologyLookup {
  getVersion(): string;
  getInfo(): TerminologyPackInfo;
  findCandidates(
    text: string,
    targetLanguage: TranslationTargetLanguage,
  ): TranslationTerminologyMatch[];
  close?(): void;
}

export class TerminologyStore implements TerminologyLookup {
  private readonly db: Database.Database;
  private readonly version: string;
  private readonly info: TerminologyPackInfo;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const sources = this.db.prepare(`
      SELECT id, name, version, license, attribution, sourceUrl
      FROM terminology_source ORDER BY id
    `).all() as SourceRow[];
    this.version = sources.length
      ? sources.map((source) => `${source.id}@${source.version}`).join('+')
      : 'empty';
    this.info = { version: this.version, sources };
  }

  getVersion(): string {
    return this.version;
  }

  getInfo(): TerminologyPackInfo {
    return this.info;
  }

  findCandidates(
    text: string,
    targetLanguage: TranslationTargetLanguage,
  ): TranslationTerminologyMatch[] {
    const sourceLanguage = targetLanguage === 'zh-CN' ? 'en' : 'zh';
    const targetTermLanguage = targetLanguage === 'zh-CN' ? 'zh' : 'en';
    const probes = buildProbes(text, sourceLanguage);
    if (!probes.length) return [];

    const placeholders = probes.map(() => '?').join(', ');
    const exactRows = this.db.prepare(`
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
      ...probes,
      MAX_CANDIDATES,
    ) as TermRow[];

    const exactMatches = deduplicate(exactRows.map(toMatch));
    const ftsQuery = buildFtsQuery(text, sourceLanguage);
    if (exactMatches.length >= MAX_CANDIDATES || !ftsQuery) {
      return exactMatches.slice(0, MAX_CANDIDATES);
    }

    const ftsRows = this.db.prepare(`
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
    ) as TermRow[];

    return deduplicate([...exactMatches, ...ftsRows.map(toMatch)])
      .slice(0, MAX_CANDIDATES);
  }

  close(): void {
    this.db.close();
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

function buildProbes(text: string, language: 'en' | 'zh'): string[] {
  if (language === 'zh') return buildChineseProbes(text);
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

function buildChineseProbes(text: string): string[] {
  const compact = text.normalize('NFKC').replace(/\s+/g, '');
  const probes = new Set<string>();
  for (let start = 0; start < compact.length; start += 1) {
    for (
      let length = 2;
      length <= MAX_CHINESE_TERM_LENGTH && start + length <= compact.length;
      length += 1
    ) {
      const candidate = compact.slice(start, start + length);
      if (/^[\p{Script=Han}\p{L}\p{N}]+$/u.test(candidate)) probes.add(candidate);
    }
  }
  return Array.from(probes).slice(0, MAX_PROBES);
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

function toMatch(row: TermRow): TranslationTerminologyMatch {
  return {
    conceptId: row.conceptId,
    sourceId: row.sourceId,
    sourceTerm: row.sourceTerm,
    targetTerm: row.targetTerm,
    definition: row.definition ?? undefined,
    domain: row.domain ?? undefined,
    reliability: row.reliability ?? undefined,
  };
}

function deduplicate(
  matches: TranslationTerminologyMatch[],
): TranslationTerminologyMatch[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = `${match.sourceId}:${match.conceptId}:${match.targetTerm}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
