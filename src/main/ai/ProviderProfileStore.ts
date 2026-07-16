import type Database from 'better-sqlite3';
import type { ProviderKind, ProviderProfile } from '../../shared/contracts/provider.types';

interface ProviderProfileRow {
  id: number;
  providerKind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKeyRef: string;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveProviderProfile extends ProviderProfile {
  apiKeyRef: string;
}

export interface SaveProviderProfileParams {
  baseUrl: string;
  model: string;
  apiKeyRef: string;
}

export class ProviderProfileStore {
  constructor(private readonly db: Database.Database) {}

  findActive(): ProviderProfile | undefined {
    const profile = this.findActiveWithSecret();
    return profile ? omitSecretReference(profile) : undefined;
  }

  findActiveWithSecret(): ActiveProviderProfile | undefined {
    const row = this.db
      .prepare('SELECT * FROM ai_provider_profile WHERE isActive = 1 LIMIT 1')
      .get() as ProviderProfileRow | undefined;
    return row ? toActiveProviderProfile(row) : undefined;
  }

  saveActive(params: SaveProviderProfileParams): ProviderProfile {
    const now = new Date().toISOString();
    const existing = this.findActiveWithSecret();

    if (existing) {
      this.db
        .prepare(`
          UPDATE ai_provider_profile
          SET baseUrl = ?, model = ?, apiKeyRef = ?, updatedAt = ?
          WHERE id = ?
        `)
        .run(params.baseUrl, params.model, params.apiKeyRef, now, existing.id);
      return omitSecretReference({
        ...existing,
        baseUrl: params.baseUrl,
        model: params.model,
        updatedAt: now,
      });
    }

    const result = this.db
      .prepare(`
        INSERT INTO ai_provider_profile
          (providerKind, baseUrl, model, apiKeyRef, isActive, createdAt, updatedAt)
        VALUES ('openai-compatible', ?, ?, ?, 1, ?, ?)
      `)
      .run(params.baseUrl, params.model, params.apiKeyRef, now, now);

    return {
      id: Number(result.lastInsertRowid),
      providerKind: 'openai-compatible',
      baseUrl: params.baseUrl,
      model: params.model,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
  }
}

function toActiveProviderProfile(row: ProviderProfileRow): ActiveProviderProfile {
  return {
    id: row.id,
    providerKind: row.providerKind,
    baseUrl: row.baseUrl,
    model: row.model,
    apiKeyRef: row.apiKeyRef,
    isActive: row.isActive === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function omitSecretReference(profile: ActiveProviderProfile): ProviderProfile {
  return {
    id: profile.id,
    providerKind: profile.providerKind,
    baseUrl: profile.baseUrl,
    model: profile.model,
    isActive: profile.isActive,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}
