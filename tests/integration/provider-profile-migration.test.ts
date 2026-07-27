import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MIGRATION_006 } from '../../src/main/migrations/006_create_ai_profiles';
import { MIGRATION_012 } from '../../src/main/migrations/012_expand_ai_providers';
import { MIGRATION_020 } from '../../src/main/migrations/020_add_provider_task_models';
import { MIGRATION_021 } from '../../src/main/migrations/021_add_translation_provider_route';

describe('provider profile migration 012', () => {
  it('preserves IDs, secret references, and foreign keys while classifying legacy profiles', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    try {
      db.exec(MIGRATION_006);
      db.prepare(`
        INSERT INTO ai_provider_profile
          (id, providerKind, baseUrl, model, apiKeyRef, isActive, createdAt, updatedAt)
        VALUES (7, 'openai-compatible', ?, 'gpt-5.4-mini', 'secret-ref', 1, ?, ?)
      `).run('https://api.openai.com/v1', 'created', 'updated');
      db.exec(`
        CREATE TABLE provider_profile_reference (
          providerId INTEGER NOT NULL REFERENCES ai_provider_profile(id)
        );
        INSERT INTO provider_profile_reference (providerId) VALUES (7);
      `);

      db.transaction(() => db.exec(MIGRATION_012))();

      expect(db.prepare('SELECT * FROM ai_provider_profile').get()).toMatchObject({
        id: 7,
        providerKind: 'openai-compatible',
        providerPreset: 'openai',
        apiKeyRef: 'secret-ref',
        model: 'gpt-5.4-mini',
      });
      expect(db.prepare('SELECT providerId FROM provider_profile_reference').get())
        .toEqual({ providerId: 7 });
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe('provider profile migration 020', () => {
  it('copies the legacy model into both task-specific model columns', () => {
    const db = new Database(':memory:');
    try {
      db.exec(MIGRATION_006);
      db.exec(MIGRATION_012);
      db.prepare(`
        INSERT INTO ai_provider_profile
          (providerKind, providerPreset, baseUrl, model, apiKeyRef,
           isActive, createdAt, updatedAt)
        VALUES ('openai-compatible', 'openai', ?, ?, 'secret-ref', 1, ?, ?)
      `).run(
        'https://api.openai.com/v1',
        'gpt-legacy-model',
        'created',
        'updated',
      );

      db.transaction(() => db.exec(MIGRATION_020))();

      expect(db.prepare(`
        SELECT model, summaryModel, translationModel
        FROM ai_provider_profile
      `).get()).toEqual({
        model: 'gpt-legacy-model',
        summaryModel: 'gpt-legacy-model',
        translationModel: 'gpt-legacy-model',
      });
    } finally {
      db.close();
    }
  });
});

describe('provider profile migration 021', () => {
  it('copies the existing Provider route and secret reference to Translation', () => {
    const db = new Database(':memory:');
    try {
      db.exec(MIGRATION_006);
      db.exec(MIGRATION_012);
      db.exec(MIGRATION_020);
      db.prepare(`
        INSERT INTO ai_provider_profile
          (providerKind, providerPreset, baseUrl, model, summaryModel,
           translationModel, apiKeyRef, isActive, createdAt, updatedAt)
        VALUES ('openai-compatible', 'deepseek', ?, ?, ?, ?, 'secret-ref', 1, ?, ?)
      `).run(
        'https://api.deepseek.com',
        'deepseek-legacy',
        'deepseek-summary',
        'deepseek-translation',
        'created',
        'updated',
      );

      db.transaction(() => db.exec(MIGRATION_021))();

      expect(db.prepare(`
        SELECT translationProviderPreset, translationBaseUrl,
               translationModel, translationApiKeyRef
        FROM ai_provider_profile
      `).get()).toEqual({
        translationProviderPreset: 'deepseek',
        translationBaseUrl: 'https://api.deepseek.com',
        translationModel: 'deepseek-translation',
        translationApiKeyRef: 'secret-ref',
      });
    } finally {
      db.close();
    }
  });
});
