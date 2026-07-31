import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DatabaseManager } from '../../src/main/database/DatabaseManager';
import { MIGRATION_006 } from '../../src/main/migrations/006_create_ai_profiles';
import { MIGRATION_012 } from '../../src/main/migrations/012_expand_ai_providers';
import { MIGRATION_020 } from '../../src/main/migrations/020_add_provider_task_models';
import { MIGRATION_021 } from '../../src/main/migrations/021_add_translation_provider_route';
import { MIGRATION_026 } from '../../src/main/migrations/026_add_chat_provider_route';

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

describe('provider profile migration 026', () => {
  it('inherits the Summary route without enabling image input implicitly', () => {
    const db = new Database(':memory:');
    try {
      db.exec(MIGRATION_006);
      db.exec(MIGRATION_012);
      db.exec(MIGRATION_020);
      db.exec(MIGRATION_021);
      db.prepare(`
        INSERT INTO ai_provider_profile
          (providerKind, providerPreset, baseUrl, model, summaryModel,
           translationProviderPreset, translationBaseUrl, translationModel,
           apiKeyRef, translationApiKeyRef, isActive, createdAt, updatedAt)
        VALUES (
          'openai-compatible', 'openrouter', ?, ?, ?,
          'deepseek', ?, ?, 'summary-secret', 'translation-secret', 1, ?, ?
        )
      `).run(
        'https://openrouter.ai/api/v1',
        'openai/gpt-5.4-mini',
        'openai/gpt-5.4-mini',
        'https://api.deepseek.com',
        'deepseek-v4-flash',
        'created',
        'updated',
      );

      db.transaction(() => db.exec(MIGRATION_026))();

      expect(db.prepare(`
        SELECT chatProviderPreset, chatBaseUrl, chatModel, chatApiKeyRef,
               chatSupportsImages
        FROM ai_provider_profile
      `).get()).toEqual({
        chatProviderPreset: 'openrouter',
        chatBaseUrl: 'https://openrouter.ai/api/v1',
        chatModel: 'openai/gpt-5.4-mini',
        chatApiKeyRef: 'summary-secret',
        chatSupportsImages: 0,
      });
    } finally {
      db.close();
    }
  });

  it('recognizes the original 022 migration identity after it was renumbered', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'shale-chat-provider-'));
    const databasePath = path.join(directory, 'shale.db');
    const initial = new DatabaseManager(databasePath);

    try {
      initial.runMigrations();
      initial.getDb().prepare(`
        UPDATE _migrations
        SET filename = '022_add_chat_provider_route'
        WHERE filename = '026_add_chat_provider_route'
      `).run();
    } finally {
      initial.close();
    }

    const upgraded = new DatabaseManager(databasePath);
    try {
      expect(() => upgraded.runMigrations()).not.toThrow();
      expect(upgraded.getDb().prepare(`
        SELECT filename
        FROM _migrations
        WHERE filename IN (
          '022_add_chat_provider_route',
          '026_add_chat_provider_route'
        )
        ORDER BY filename
      `).all()).toEqual([
        { filename: '022_add_chat_provider_route' },
        { filename: '026_add_chat_provider_route' },
      ]);

      const providerColumns = upgraded.getDb()
        .pragma('table_info(ai_provider_profile)') as Array<{ name: string }>;
      const chatColumns = providerColumns.filter(({ name }) =>
        name.startsWith('chat'));
      expect(chatColumns).toHaveLength(5);
    } finally {
      upgraded.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
