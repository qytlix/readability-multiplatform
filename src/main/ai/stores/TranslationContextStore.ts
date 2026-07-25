import type Database from 'better-sqlite3';
import type {
  TranslationContext,
  TranslationContextIdentity,
} from '../../../shared/contracts/translation-context.types';

interface TranslationContextRow {
  contextJson: string;
}

export class TranslationContextStore {
  constructor(private readonly db: Database.Database) {}

  find(identity: TranslationContextIdentity): TranslationContext | undefined {
    const row = this.db.prepare(`
      SELECT contextJson FROM translation_context_cache
      WHERE sourceContentHash = ?
        AND sourceLanguage = ?
        AND targetLanguage = ?
        AND providerProfileId = ?
        AND providerModel = ?
        AND expertId = ?
        AND expertContentHash = ?
        AND promptVersion = ?
    `).get(
      identity.sourceContentHash,
      identity.sourceLanguage,
      identity.targetLanguage,
      identity.providerProfileId,
      identity.providerModel,
      identity.expertId,
      identity.expertContentHash,
      identity.promptVersion,
    ) as TranslationContextRow | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.contextJson) as TranslationContext;
    } catch {
      return undefined;
    }
  }

  save(
    identity: TranslationContextIdentity,
    context: TranslationContext,
  ): TranslationContext {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO translation_context_cache (
        sourceContentHash, sourceLanguage, targetLanguage,
        providerProfileId, providerModel, expertId, expertContentHash,
        promptVersion, contextJson, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(
        sourceContentHash,
        sourceLanguage,
        targetLanguage,
        providerProfileId,
        providerModel,
        expertId,
        expertContentHash,
        promptVersion
      ) DO UPDATE SET
        contextJson = excluded.contextJson,
        updatedAt = excluded.updatedAt
    `).run(
      identity.sourceContentHash,
      identity.sourceLanguage,
      identity.targetLanguage,
      identity.providerProfileId,
      identity.providerModel,
      identity.expertId,
      identity.expertContentHash,
      identity.promptVersion,
      JSON.stringify(context),
      now,
      now,
    );
    return context;
  }
}
