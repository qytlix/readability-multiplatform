import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type {
  BuiltInExpertBundle,
  TranslationExpert,
} from '../../../shared/contracts/translation-expert.types';

interface UserExpertRow {
  id: string;
  version: string;
  name: string;
  description: string;
  author: string;
  details: string;
  instruction: string;
  contentHash: string;
  matchesJson: string;
  warningsJson: string;
}

export class TranslationExpertStore {
  private readonly builtIns: Map<string, TranslationExpert>;

  constructor(
    private readonly db: Database.Database,
    bundle: BuiltInExpertBundle,
  ) {
    if (bundle.schemaVersion !== 1 || bundle.experts.length !== 29) {
      throw new Error('The built-in AI expert bundle is invalid or incomplete.');
    }
    const uniqueIds = new Set(bundle.experts.map((expert) => expert.id));
    const isMalformed = uniqueIds.size !== bundle.experts.length
      || bundle.experts.some((expert) =>
        !expert.id
        || !expert.name
        || !expert.version
        || !expert.instruction.trim()
        || !/^[a-f0-9]{64}$/.test(expert.sourceSha256)
        || !/^[a-f0-9]{64}$/.test(expert.compiledSha256)
        || expert.compiledSha256 !== compiledExpertHash(
          expert.id,
          expert.version,
          expert.instruction,
        ));
    if (isMalformed) {
      throw new Error('The built-in AI expert bundle failed integrity validation.');
    }
    this.builtIns = new Map(bundle.experts.map((expert) => [
      expert.id,
      {
        id: expert.id,
        version: expert.version,
        name: expert.name,
        description: expert.description,
        author: expert.author,
        details: expert.details,
        origin: 'builtin',
        instruction: expert.instruction,
        contentHash: expert.compiledSha256,
        matches: expert.matches,
        warnings: expert.warnings,
      },
    ]));
  }

  list(): TranslationExpert[] {
    return [
      ...Array.from(this.builtIns.values()),
      ...this.listUsers(),
    ].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
  }

  find(id: string): TranslationExpert | undefined {
    return this.builtIns.get(id) ?? this.findUser(id);
  }

  isBuiltIn(id: string): boolean {
    return this.builtIns.has(id);
  }

  findUser(id: string): TranslationExpert | undefined {
    const row = this.db.prepare(`
      SELECT id, version, name, description, author, details, instruction,
             contentHash, matchesJson, warningsJson
      FROM translation_expert_user WHERE id = ?
    `).get(id) as UserExpertRow | undefined;
    return row ? toUserExpert(row) : undefined;
  }

  saveUser(expert: TranslationExpert, sourceYaml: string): TranslationExpert {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO translation_expert_user (
        id, version, name, description, author, details, instruction,
        contentHash, matchesJson, warningsJson, sourceYaml, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        version = excluded.version,
        name = excluded.name,
        description = excluded.description,
        author = excluded.author,
        details = excluded.details,
        instruction = excluded.instruction,
        contentHash = excluded.contentHash,
        matchesJson = excluded.matchesJson,
        warningsJson = excluded.warningsJson,
        sourceYaml = excluded.sourceYaml,
        updatedAt = excluded.updatedAt
    `).run(
      expert.id,
      expert.version,
      expert.name,
      expert.description,
      expert.author,
      expert.details,
      expert.instruction,
      expert.contentHash,
      JSON.stringify(expert.matches),
      JSON.stringify(expert.warnings),
      sourceYaml,
      now,
      now,
    );
    const saved = this.findUser(expert.id);
    if (!saved) throw new Error('The imported AI expert was not persisted.');
    return saved;
  }

  removeUser(id: string): boolean {
    return this.db.prepare('DELETE FROM translation_expert_user WHERE id = ?')
      .run(id).changes > 0;
  }

  private listUsers(): TranslationExpert[] {
    const rows = this.db.prepare(`
      SELECT id, version, name, description, author, details, instruction,
             contentHash, matchesJson, warningsJson
      FROM translation_expert_user ORDER BY name COLLATE NOCASE, id
    `).all() as UserExpertRow[];
    return rows.map(toUserExpert);
  }
}

function compiledExpertHash(id: string, version: string, instruction: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ id, version, instruction }))
    .digest('hex');
}

function toUserExpert(row: UserExpertRow): TranslationExpert {
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    description: row.description,
    author: row.author,
    details: row.details,
    origin: 'user',
    instruction: row.instruction,
    contentHash: row.contentHash,
    matches: parseStringArray(row.matchesJson),
    warnings: parseStringArray(row.warningsJson),
  };
}

function parseStringArray(serialized: string): string[] {
  try {
    const value: unknown = JSON.parse(serialized);
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}
