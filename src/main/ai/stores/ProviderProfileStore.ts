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
  chatProviderPreset: ProviderKind;
  chatBaseUrl: string;
  chatModel: string;
  apiKeyRef: string;
  translationApiKeyRef: string;
  tagApiKeyRef: string;
  chatApiKeyRef: string;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveProviderProfile extends ProviderProfile {
  apiKeyRef: string;
  translationApiKeyRef: string;
  tagApiKeyRef: string;
  chatApiKeyRef: string;
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
  chat?: SaveProviderTaskProfileParams;
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
    const chat = resolveChatProfile(params, existing, summary);

    if (existing) {
      this.db
        .prepare(`
          UPDATE ai_provider_profile
          SET providerPreset = ?, baseUrl = ?, model = ?,
              summaryModel = ?, translationProviderPreset = ?,
              translationBaseUrl = ?, translationModel = ?,
              tagProviderPreset = ?, tagBaseUrl = ?, tagModel = ?,
              chatProviderPreset = ?, chatBaseUrl = ?, chatModel = ?,
              apiKeyRef = ?, translationApiKeyRef = ?, tagApiKeyRef = ?,
              chatApiKeyRef = ?,
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
          chat.providerKind,
          chat.baseUrl,
          chat.model,
          summary.apiKeyRef,
          translation.apiKeyRef,
          tag.apiKeyRef,
          chat.apiKeyRef,
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
        chatProviderKind: chat.providerKind,
        chatBaseUrl: chat.baseUrl,
        chatModel: chat.model,
        apiKeyRef: summary.apiKeyRef,
        translationApiKeyRef: translation.apiKeyRef,
        tagApiKeyRef: tag.apiKeyRef,
        chatApiKeyRef: chat.apiKeyRef,
        updatedAt: now,
      });
    }

    const result = this.db
      .prepare(`
        INSERT INTO ai_provider_profile
          (providerKind, providerPreset, baseUrl, model, summaryModel,
           translationProviderPreset, translationBaseUrl, translationModel,
           tagProviderPreset, tagBaseUrl, tagModel,
           chatProviderPreset, chatBaseUrl, chatModel,
           apiKeyRef, translationApiKeyRef, tagApiKeyRef, chatApiKeyRef,
           isActive, createdAt, updatedAt)
        VALUES ('openai-compatible', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
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
        chat.providerKind,
        chat.baseUrl,
        chat.model,
        summary.apiKeyRef,
        translation.apiKeyRef,
        tag.apiKeyRef,
        chat.apiKeyRef,
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
      chatProviderKind: chat.providerKind,
      chatBaseUrl: chat.baseUrl,
      chatModel: chat.model,
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
    chatProviderKind: row.chatProviderPreset,
    chatBaseUrl: row.chatBaseUrl,
    chatModel: row.chatModel,
    apiKeyRef: row.apiKeyRef,
    translationApiKeyRef: row.translationApiKeyRef,
    tagApiKeyRef: row.tagApiKeyRef,
    chatApiKeyRef: row.chatApiKeyRef,
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
    chatProviderKind: profile.chatProviderKind,
    chatBaseUrl: profile.chatBaseUrl,
    chatModel: profile.chatModel,
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

function resolveChatProfile(
  params: SaveProviderProfileParams,
  existing: ActiveProviderProfile | undefined,
  summary: SaveProviderTaskProfileParams,
): SaveProviderTaskProfileParams {
  if (params.chat) return params.chat;
  if (existing) {
    return {
      providerKind: existing.chatProviderKind,
      baseUrl: existing.chatBaseUrl,
      model: existing.chatModel,
      apiKeyRef: existing.chatApiKeyRef,
    };
  }
  return summary;
}
