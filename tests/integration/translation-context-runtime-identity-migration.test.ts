import { describe, expect, it } from 'vitest';
import SqliteDatabase from 'better-sqlite3';
import { TRANSLATION_CONTEXT_SCHEMA_VERSION } from '../../src/shared/contracts/translation-context.types';
import {
  buildTranslationContextIdentity,
  buildTranslationProviderRuntimeIdentity,
} from '../../src/main/ai/services/TranslationContextService';
import { TranslationContextStore } from '../../src/main/ai/stores/TranslationContextStore';
import { MIGRATION_027 } from '../../src/main/migrations/027_add_translation_context_provider_runtime_identity';

describe('Translation context Provider runtime identity migration', () => {
  it('preserves legacy rows but never reuses them, while allowing the new identity to coexist', () => {
    const db = new SqliteDatabase(':memory:');
    db.exec(`
      CREATE TABLE ai_provider_profile (id INTEGER PRIMARY KEY);
      INSERT INTO ai_provider_profile (id) VALUES (1);
      CREATE TABLE translation_context_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sourceContentHash TEXT NOT NULL,
        sourceLanguage TEXT NOT NULL,
        targetLanguage TEXT NOT NULL,
        providerProfileId INTEGER NOT NULL REFERENCES ai_provider_profile(id),
        providerModel TEXT NOT NULL,
        expertId TEXT NOT NULL,
        expertContentHash TEXT NOT NULL,
        promptVersion TEXT NOT NULL,
        contextJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        UNIQUE (
          sourceContentHash, sourceLanguage, targetLanguage, providerProfileId,
          providerModel, expertId, expertContentHash, promptVersion
        )
      );
    `);
    const legacyContext = JSON.stringify({
      schemaVersion: TRANSLATION_CONTEXT_SCHEMA_VERSION,
      theme: 'legacy context',
      keyTerms: [],
      styleGuide: [],
    });
    db.prepare(`
      INSERT INTO translation_context_cache (
        sourceContentHash, sourceLanguage, targetLanguage, providerProfileId,
        providerModel, expertId, expertContentHash, promptVersion,
        contextJson, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'content', 'en', 'zh-CN', 1, 'model', 'none', 'none',
      'translation-context-v2', legacyContext,
      '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z',
    );

    db.exec(MIGRATION_027);
    const store = new TranslationContextStore(db);
    const identity = buildTranslationContextIdentity({
      sourceContentHash: 'content',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      providerProfileId: 1,
      providerModel: 'model',
      providerRuntimeIdentity: buildTranslationProviderRuntimeIdentity({
        kind: 'openai',
        baseUrl: 'https://provider.example/v1',
        credentialReference: 'opaque-credential-reference',
      }),
      expertId: 'none',
      expertContentHash: 'none',
    });

    expect(store.find(identity)).toBeUndefined();
    store.save(identity, {
      schemaVersion: TRANSLATION_CONTEXT_SCHEMA_VERSION,
      theme: 'current context',
      keyTerms: [],
      styleGuide: [],
    });
    expect(store.find(identity)).toMatchObject({ theme: 'current context' });
    expect(db.prepare(`
      SELECT providerRuntimeIdentity, contextJson FROM translation_context_cache ORDER BY id
    `).all()).toEqual([
      { providerRuntimeIdentity: null, contextJson: legacyContext },
      expect.objectContaining({ providerRuntimeIdentity: identity.providerRuntimeIdentity }),
    ]);
    db.close();
  });
});
