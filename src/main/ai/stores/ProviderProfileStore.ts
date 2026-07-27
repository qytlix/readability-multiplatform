import type Database from 'better-sqlite3';
import type { ProviderKind, ProviderProfile } from '../../../shared/contracts/provider.types';

interface ProviderProfileRow {
  id: number;
  providerPreset: ProviderKind;
  baseUrl: string;
  model: string;
  summaryModel: string;
  translationProviderPreset: ProviderKind;
  translationBaseUrl: string;
  translationModel: string;
  tagProviderPreset: ProviderKind;
  tagBaseUrl: string;
  tagModel: string;
  apiKeyRef: string;
  translationApiKeyRef: string;
  tagApiKeyRef: string;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveProviderProfile extends ProviderProfile {
  apiKeyRef: string;
  translationApiKeyRef: string;
  tagApiKeyRef: string;
}

interface SaveProviderTaskProfileParams {
  providerKind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKeyRef: string;
}

export interface SaveProviderProfileParams {
  summary?: SaveProviderTaskProfileParams;
  translation?: SaveProviderTaskProfileParams;
  tag?: SaveProviderTaskProfileParams;
  providerKind?: ProviderKind;
  baseUrl?: string;
  summaryModel?: string;
  translationModel?: string;
  /** Compatibility input for tests and callers predating migration 020. */
  model?: string;
  apiKeyRef?: string;
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
    const { summary, translation } = resolveTaskProfiles(params);

    const { tag } = resolveTagProfile(params);

    if (existing) {
      this.db
        .prepare(`
          UPDATE ai_provider_profile
          SET providerPreset = ?, baseUrl = ?, model = ?,
              summaryModel = ?, translationProviderPreset = ?,
              translationBaseUrl = ?, translationModel = ?,
              tagProviderPreset = ?, tagBaseUrl = ?, tagModel = ?,
              apiKeyRef = ?, translationApiKeyRef = ?, tagApiKeyRef = ?,
              updatedAt = ?
          WHERE id = ?
        `)
        .run(
          summary.providerKind,
          summary.baseUrl,
          summary.model,
          summary.model,
          translation.providerKind,
          translation.baseUrl,
          translation.model,
          tag.providerKind,
          tag.baseUrl,
          tag.model,
          summary.apiKeyRef,
          translation.apiKeyRef,
          tag.apiKeyRef,
          now,
          existing.id,
        );
      return omitSecretReference({
        ...existing,
        providerKind: summary.providerKind,
        baseUrl: summary.baseUrl,
        model: summary.model,
        summaryModel: summary.model,
        translationProviderKind: translation.providerKind,
        translationBaseUrl: translation.baseUrl,
        translationModel: translation.model,
        tagProviderKind: tag.providerKind,
        tagBaseUrl: tag.baseUrl,
        tagModel: tag.model,
        apiKeyRef: summary.apiKeyRef,
        translationApiKeyRef: translation.apiKeyRef,
        tagApiKeyRef: tag.apiKeyRef,
        updatedAt: now,
      });
    }

    const result = this.db
      .prepare(`
        INSERT INTO ai_provider_profile
          (providerKind, providerPreset, baseUrl, model, summaryModel,
           translationProviderPreset, translationBaseUrl, translationModel,
           tagProviderPreset, tagBaseUrl, tagModel,
           apiKeyRef, translationApiKeyRef, tagApiKeyRef,
           isActive, createdAt, updatedAt)
        VALUES ('openai-compatible', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `)
      .run(
        summary.providerKind,
        summary.baseUrl,
        summary.model,
        summary.model,
        translation.providerKind,
        translation.baseUrl,
        translation.model,
        tag.providerKind,
        tag.baseUrl,
        tag.model,
        summary.apiKeyRef,
        translation.apiKeyRef,
        tag.apiKeyRef,
        now,
        now,
      );

    return {
      id: Number(result.lastInsertRowid),
      providerKind: summary.providerKind,
      baseUrl: summary.baseUrl,
      model: summary.model,
      summaryModel: summary.model,
      translationProviderKind: translation.providerKind,
      translationBaseUrl: translation.baseUrl,
      translationModel: translation.model,
      tagProviderKind: tag.providerKind,
      tagBaseUrl: tag.baseUrl,
      tagModel: tag.model,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
  }
}

function toActiveProviderProfile(row: ProviderProfileRow): ActiveProviderProfile {
  return {
    id: row.id,
    providerKind: row.providerPreset,
    baseUrl: row.baseUrl,
    model: row.model,
    summaryModel: row.summaryModel,
    translationProviderKind: row.translationProviderPreset,
    translationBaseUrl: row.translationBaseUrl,
    translationModel: row.translationModel,
    tagProviderKind: row.tagProviderPreset,
    tagBaseUrl: row.tagBaseUrl,
    tagModel: row.tagModel,
    apiKeyRef: row.apiKeyRef,
    translationApiKeyRef: row.translationApiKeyRef,
    tagApiKeyRef: row.tagApiKeyRef,
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
    summaryModel: profile.summaryModel,
    translationProviderKind: profile.translationProviderKind,
    translationBaseUrl: profile.translationBaseUrl,
    translationModel: profile.translationModel,
    tagProviderKind: profile.tagProviderKind,
    tagBaseUrl: profile.tagBaseUrl,
    tagModel: profile.tagModel,
    isActive: profile.isActive,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function resolveTaskProfiles(params: SaveProviderProfileParams): {
  summary: SaveProviderTaskProfileParams;
  translation: SaveProviderTaskProfileParams;
} {
  if (params.summary && params.translation) {
    return { summary: params.summary, translation: params.translation };
  }
  const summaryModel = params.summaryModel ?? params.model;
  const translationModel = params.translationModel ?? params.model;
  if (
    !params.providerKind
    || !params.baseUrl
    || !summaryModel
    || !translationModel
    || !params.apiKeyRef
  ) {
    throw new Error('Summary and Translation Provider routes are required.');
  }
  return {
    summary: {
      providerKind: params.providerKind,
      baseUrl: params.baseUrl,
      model: summaryModel,
      apiKeyRef: params.apiKeyRef,
    },
    translation: {
      providerKind: params.providerKind,
      baseUrl: params.baseUrl,
      model: translationModel,
      apiKeyRef: params.apiKeyRef,
    },
  };
}

function resolveTagProfile(params: SaveProviderProfileParams): {
  tag: SaveProviderTaskProfileParams;
} {
  if (params.tag) {
    return { tag: params.tag };
  }
  // Legacy single-profile callers: inherit Summary's provider kind and base URL
  // but use a default tag model. The tagApiKeyRef is left empty so that the
  // user is prompted to configure it explicitly.
  const providerKind = params.providerKind ?? 'openai';
  const baseUrl = params.baseUrl ?? '';
  return {
    tag: {
      providerKind,
      baseUrl,
      model: 'gpt-5.4-mini',
      apiKeyRef: '',
    },
  };
}
