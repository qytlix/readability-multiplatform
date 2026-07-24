import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MIGRATION_006 } from '../../src/main/migrations/006_create_ai_profiles';
import { MIGRATION_012 } from '../../src/main/migrations/012_expand_ai_providers';

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
