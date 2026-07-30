import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  isProviderKind,
  isValidProviderModel,
  type ProviderConnectionTestResult,
  type ProviderKind,
  type ProviderProfile,
  type SaveProviderRequest,
} from '../../../shared/contracts/provider.types';
import { SUMMARY_ERROR_CODES, SummaryError } from '../../../shared/errors/summary.errors';
import { ProviderProfileStore } from '../stores/ProviderProfileStore';
import { SecretStore } from '../stores/SecretStore';
import type { TextGenerationProvider } from '../provider/TextGenerationProvider';
import {
  elapsedProviderMilliseconds,
  logProviderConfigCompleted,
  logProviderConfigFailed,
  logProviderConnectionCompleted,
  logProviderConnectionFailed,
  logProviderSecretCleanupFailed,
  PROVIDER_LOG_ERROR_CODES,
  type ProviderConfigStage,
  type ProviderConnectionStage,
  type ProviderOperationLogger,
} from './ProviderLogging';

export class ProviderService {
  constructor(
    private readonly profileStore: ProviderProfileStore,
    private readonly secretStore: SecretStore,
    private readonly provider: TextGenerationProvider,
    private readonly logger?: ProviderOperationLogger,
  ) {}

  getActiveProfile(): ProviderProfile | undefined {
    const profile = this.profileStore.findActiveWithSecret();
    return profile ? this.toPublicProfile(profile) : undefined;
  }

  save(request: SaveProviderRequest): ProviderProfile {
    const startedAt = performance.now();
    let stage: ProviderConfigStage = 'validate';
    const newlyStoredSecretReferences: string[] = [];
    try {
      const routes = validateProviderRequest(request);
      stage = 'profileLookup';
      const existing = this.profileStore.findActiveWithSecret();
      stage = 'key';
      const summarySuppliedKey = routes.summary.apiKey?.trim();
      const translationSuppliedKey = routes.translation.apiKey?.trim();
      const tagSuppliedKey = routes.tag.apiKey?.trim();
      const chatSuppliedKey = routes.chat.apiKey?.trim();
      let summaryApiKeyRef = reusableKeyReference(
        existing,
        'summary',
        routes.summary,
      );
      let translationApiKeyRef = reusableKeyReference(
        existing,
        'translation',
        routes.translation,
      );
      let tagApiKeyRef = reusableKeyReference(
        existing,
        'tag',
        routes.tag,
      );
      let chatApiKeyRef = reusableKeyReference(
        existing,
        'chat',
        routes.chat,
      );
      const secretWrites = new Map<string, string>();

      const referencesBySuppliedKey = new Map<string, string>();
      const assignSuppliedKey = (
        suppliedKey: string | undefined,
        currentReference: string | undefined,
      ): string | undefined => {
        if (!suppliedKey) return currentReference;
        const sharedReference = referencesBySuppliedKey.get(suppliedKey);
        if (sharedReference) return sharedReference;
        const reference = randomUUID();
        referencesBySuppliedKey.set(suppliedKey, reference);
        secretWrites.set(reference, suppliedKey);
        return reference;
      };

      summaryApiKeyRef = assignSuppliedKey(summarySuppliedKey, summaryApiKeyRef);
      translationApiKeyRef = assignSuppliedKey(
        translationSuppliedKey,
        translationApiKeyRef,
      );
      tagApiKeyRef = assignSuppliedKey(tagSuppliedKey, tagApiKeyRef);
      chatApiKeyRef = assignSuppliedKey(chatSuppliedKey, chatApiKeyRef);

      const routeReferences = [
        { route: routes.summary, reference: summaryApiKeyRef },
        { route: routes.translation, reference: translationApiKeyRef },
        { route: routes.chat, reference: chatApiKeyRef },
      ];
      for (const candidate of routeReferences) {
        if (candidate.reference) continue;
        candidate.reference = routeReferences.find((other) => (
          other.reference && hasSameCredentialScope(candidate.route, other.route)
        ))?.reference;
      }
      [summaryApiKeyRef, translationApiKeyRef, chatApiKeyRef] =
        routeReferences.map((candidate) => candidate.reference);

      // Tag may remain unconfigured without blocking the three reading tasks.
      tagApiKeyRef ??= '';
      if (!summaryApiKeyRef || !translationApiKeyRef || !chatApiKeyRef) {
        throw new SummaryError(
          SUMMARY_ERROR_CODES.SUMMARY_KEY_MISSING,
          'A new API key is required for each Provider whose type or host changed.',
          false,
        );
      }

      try {
        for (const [reference, apiKey] of secretWrites) {
          this.secretStore.save(reference, apiKey);
          newlyStoredSecretReferences.push(reference);
        }
        stage = 'profileSave';
        const profile = this.profileStore.saveActive({
          summary: {
            providerKind: routes.summary.providerKind,
            baseUrl: routes.summary.baseUrl,
            model: routes.summary.model,
            apiKeyRef: summaryApiKeyRef,
          },
          translation: {
            providerKind: routes.translation.providerKind,
            baseUrl: routes.translation.baseUrl,
            model: routes.translation.model,
            apiKeyRef: translationApiKeyRef,
          },
          tag: {
            providerKind: routes.tag.providerKind,
            baseUrl: routes.tag.baseUrl,
            model: routes.tag.model,
            apiKeyRef: tagApiKeyRef,
          },
          chat: {
            providerKind: routes.chat.providerKind,
            baseUrl: routes.chat.baseUrl,
            model: routes.chat.model,
            apiKeyRef: chatApiKeyRef,
            supportsImages: routes.chat.supportsImages,
          },
        });
        const retainedReferences = new Set([
          summaryApiKeyRef,
          translationApiKeyRef,
          tagApiKeyRef,
          chatApiKeyRef,
        ]);
        const obsoleteReferences = existing
          ? new Set([
            existing.apiKeyRef,
            existing.translationApiKeyRef,
            existing.tagApiKeyRef,
            existing.chatApiKeyRef,
          ])
          : new Set<string>();
        for (const reference of obsoleteReferences) {
          if (retainedReferences.has(reference)) continue;
          try {
            this.secretStore.delete(reference);
          } catch {
            logProviderSecretCleanupFailed(this.logger, {
              providerId: profile.id,
              durationMs: elapsedProviderMilliseconds(startedAt),
              stage: 'cleanup',
              errorCode: PROVIDER_LOG_ERROR_CODES.secretCleanupFailed,
            });
          }
        }
        stage = 'key';
        const hasSummaryApiKey = this.secretStore.has(summaryApiKeyRef);
        const hasTranslationApiKey = this.secretStore.has(translationApiKeyRef);
        const hasTagApiKey = this.secretStore.has(tagApiKeyRef);
        const hasChatApiKey = this.secretStore.has(chatApiKeyRef);
        const result: ProviderProfile = {
          ...profile,
          keyStorageMode: this.secretStore.getStorageMode(),
          hasApiKey: hasSummaryApiKey,
          hasSummaryApiKey,
          hasTranslationApiKey,
          hasTagApiKey,
          hasChatApiKey,
        };
        logProviderConfigCompleted(this.logger, {
          providerId: profile.id,
          durationMs: elapsedProviderMilliseconds(startedAt),
          success: true,
        });
        return result;
      } catch (error) {
        for (const reference of newlyStoredSecretReferences) {
          try {
            this.secretStore.delete(reference);
          } catch (rollbackError) {
            stage = 'key';
            throw rollbackError;
          }
        }
        throw error;
      }
    } catch (error) {
      logProviderConfigFailed(this.logger, {
        durationMs: elapsedProviderMilliseconds(startedAt),
        success: false,
        stage,
        errorCode: toConfigErrorCode(stage, error),
      });
      throw error;
    }
  }

  async testConnection(): Promise<ProviderConnectionTestResult> {
    const startedAt = performance.now();
    let stage: ProviderConnectionStage = 'profile';
    let providerId: number | undefined;
    try {
      const profile = this.profileStore.findActiveWithSecret();
      if (!profile) {
        throw new SummaryError(
          SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_NOT_CONFIGURED,
          'Configure a Summary provider before testing the connection.',
          false,
        );
      }

      providerId = profile.id;
      const routes = [
        {
          providerKind: profile.providerKind,
          baseUrl: profile.baseUrl,
          model: profile.summaryModel,
          apiKeyRef: profile.apiKeyRef,
        },
        {
          providerKind: profile.translationProviderKind,
          baseUrl: profile.translationBaseUrl,
          model: profile.translationModel,
          apiKeyRef: profile.translationApiKeyRef,
        },
        {
          providerKind: profile.tagProviderKind,
          baseUrl: profile.tagBaseUrl,
          model: profile.tagModel,
          apiKeyRef: profile.tagApiKeyRef,
        },
        {
          providerKind: profile.chatProviderKind,
          baseUrl: profile.chatBaseUrl,
          model: profile.chatModel,
          apiKeyRef: profile.chatApiKeyRef,
        },
      ];
      const distinctRoutes = [...new Map(routes.map((route) => [
        [
          route.providerKind,
          route.baseUrl,
          route.model,
          route.apiKeyRef,
        ].join('\u0000'),
        route,
      ])).values()].filter((r) => r.apiKeyRef);
      for (const route of distinctRoutes) {
        stage = 'key';
        const apiKey = this.secretStore.read(route.apiKeyRef);
        stage = 'request';
        await this.provider.testConnection({
          providerKind: route.providerKind,
          baseUrl: route.baseUrl,
          model: route.model,
          apiKey,
        });
      }
      const routeCount = distinctRoutes.length;
      const message = routeCount === 1
        ? 'Provider connection succeeded.'
        : routeCount === 2
          ? 'Summary and Translation Provider connections succeeded.'
          : routeCount === 3
            ? 'Three Provider routes succeeded.'
            : 'Summary, Translation, Tag and Chat Provider connections succeeded.';
      const result: ProviderConnectionTestResult = {
        ok: true,
        message,
      };
      logProviderConnectionCompleted(this.logger, {
        providerId,
        durationMs: elapsedProviderMilliseconds(startedAt),
        success: true,
      });
      return result;
    } catch (error) {
      logProviderConnectionFailed(this.logger, {
        durationMs: elapsedProviderMilliseconds(startedAt),
        success: false,
        stage,
        errorCode: toConnectionErrorCode(stage, error),
        ...(providerId === undefined ? {} : { providerId }),
      });
      throw error;
    }
  }

  async testChatConnection(): Promise<ProviderConnectionTestResult> {
    const startedAt = performance.now();
    let stage: ProviderConnectionStage = 'profile';
    let providerId: number | undefined;
    try {
      const profile = this.profileStore.findActiveWithSecret();
      if (!profile) {
        throw new SummaryError(
          SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_NOT_CONFIGURED,
          'Configure an AI Chat provider before testing the connection.',
          false,
        );
      }
      providerId = profile.id;
      stage = 'key';
      const apiKey = this.secretStore.read(profile.chatApiKeyRef);
      stage = 'request';
      await this.provider.testConnection({
        providerKind: profile.chatProviderKind,
        baseUrl: profile.chatBaseUrl,
        model: profile.chatModel,
        apiKey,
      });
      const result: ProviderConnectionTestResult = {
        ok: true,
        message: 'AI Chat Provider connection succeeded.',
      };
      logProviderConnectionCompleted(this.logger, {
        providerId,
        durationMs: elapsedProviderMilliseconds(startedAt),
        success: true,
      });
      return result;
    } catch (error) {
      logProviderConnectionFailed(this.logger, {
        durationMs: elapsedProviderMilliseconds(startedAt),
        success: false,
        stage,
        errorCode: toConnectionErrorCode(stage, error),
        ...(providerId === undefined ? {} : { providerId }),
      });
      throw error;
    }
  }

  private toPublicProfile(profile: NonNullable<ReturnType<ProviderProfileStore['findActiveWithSecret']>>): ProviderProfile {
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
      chatSupportsImages: profile.chatSupportsImages,
      isActive: profile.isActive,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      keyStorageMode: this.secretStore.getStorageMode(),
      hasApiKey: this.secretStore.has(profile.apiKeyRef),
      hasSummaryApiKey: this.secretStore.has(profile.apiKeyRef),
      hasTranslationApiKey: this.secretStore.has(profile.translationApiKeyRef),
      hasTagApiKey: this.secretStore.has(profile.tagApiKeyRef),
      hasChatApiKey: this.secretStore.has(profile.chatApiKeyRef),
    };
  }
}

function toConfigErrorCode(
  stage: ProviderConfigStage,
  error: unknown,
): typeof PROVIDER_LOG_ERROR_CODES[keyof typeof PROVIDER_LOG_ERROR_CODES] {
  if (stage === 'validate') return PROVIDER_LOG_ERROR_CODES.invalidRequest;
  if (stage === 'profileLookup') return PROVIDER_LOG_ERROR_CODES.profileLookupFailed;
  if (stage === 'profileSave') return PROVIDER_LOG_ERROR_CODES.profileSaveFailed;

  if (error instanceof SummaryError) {
    if (error.code === SUMMARY_ERROR_CODES.SUMMARY_KEY_MISSING) {
      return PROVIDER_LOG_ERROR_CODES.keyMissing;
    }
  }
  return PROVIDER_LOG_ERROR_CODES.keyStorageUnavailable;
}

function toConnectionErrorCode(
  stage: ProviderConnectionStage,
  error: unknown,
): typeof PROVIDER_LOG_ERROR_CODES[keyof typeof PROVIDER_LOG_ERROR_CODES] {
  if (stage === 'profile') {
    if (
      error instanceof SummaryError
      && error.code === SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_NOT_CONFIGURED
    ) {
      return PROVIDER_LOG_ERROR_CODES.providerNotConfigured;
    }
    return PROVIDER_LOG_ERROR_CODES.profileLookupFailed;
  }

  if (stage === 'key') {
    if (
      error instanceof SummaryError
      && error.code === SUMMARY_ERROR_CODES.SUMMARY_KEY_MISSING
    ) {
      return PROVIDER_LOG_ERROR_CODES.keyMissing;
    }
    return PROVIDER_LOG_ERROR_CODES.keyStorageUnavailable;
  }

  if (error instanceof SummaryError) {
    switch (error.code) {
      case SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_AUTH:
        return PROVIDER_LOG_ERROR_CODES.providerAuth;
      case SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_REQUEST_FAILED:
        return PROVIDER_LOG_ERROR_CODES.providerRequestFailed;
      case SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_TIMEOUT:
        return PROVIDER_LOG_ERROR_CODES.providerTimeout;
      case SUMMARY_ERROR_CODES.SUMMARY_INTERRUPTED:
        return PROVIDER_LOG_ERROR_CODES.providerInterrupted;
      case SUMMARY_ERROR_CODES.SUMMARY_NETWORK_ERROR:
        return PROVIDER_LOG_ERROR_CODES.networkError;
      default:
        return PROVIDER_LOG_ERROR_CODES.unknownError;
    }
  }
  return PROVIDER_LOG_ERROR_CODES.unknownError;
}

interface ValidatedProviderRoute {
  providerKind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

interface ValidatedChatProviderRoute extends ValidatedProviderRoute {
  supportsImages: boolean;
}

function validateProviderRequest(request: SaveProviderRequest): {
  summary: ValidatedProviderRoute;
  translation: ValidatedProviderRoute;
  tag: ValidatedProviderRoute;
  chat: ValidatedChatProviderRoute;
} {
  if ('summary' in request) {
    const summary = validateProviderRoute(request.summary, 'Summary');
    const chat = request.chat
      ? {
        ...validateProviderRoute(request.chat, 'Chat'),
        supportsImages: request.chat.supportsImages === true,
      }
      : { ...summary, supportsImages: false };
    return {
      summary,
      translation: validateProviderRoute(request.translation, 'Translation'),
      tag: validateProviderRoute(request.tag, 'Tag'),
      chat,
    };
  }

  const legacyModel = 'model' in request ? request.model : undefined;
  return {
    summary: validateProviderRoute({
      providerKind: request.providerKind,
      baseUrl: request.baseUrl,
      model: request.summaryModel ?? legacyModel ?? '',
      ...(request.apiKey ? { apiKey: request.apiKey } : {}),
    }, legacyModel === undefined ? 'Summary' : undefined),
    translation: validateProviderRoute({
      providerKind: request.providerKind,
      baseUrl: request.baseUrl,
      model: request.translationModel ?? legacyModel ?? '',
      ...(request.apiKey ? { apiKey: request.apiKey } : {}),
    }, legacyModel === undefined ? 'Translation' : undefined),
    tag: {
      providerKind: 'openai',
      baseUrl: '',
      model: 'gpt-5.4-mini',
    },
    chat: {
      ...validateProviderRoute({
        providerKind: request.providerKind,
        baseUrl: request.baseUrl,
        model: request.summaryModel ?? legacyModel ?? '',
        ...(request.apiKey ? { apiKey: request.apiKey } : {}),
      }, 'Chat'),
      supportsImages: false,
    },
  };
}

function validateProviderRoute(
  route: ValidatedProviderRoute,
  taskLabel: 'Summary' | 'Translation' | 'Tag' | 'Chat' | undefined,
): ValidatedProviderRoute {
  if (!isProviderKind(route.providerKind)) {
    throw new SummaryError(
      SUMMARY_ERROR_CODES.SUMMARY_INVALID_REQUEST,
      taskLabel
        ? `Select a supported ${taskLabel} provider type.`
        : 'Select a supported provider type.',
      false,
    );
  }

  const model = validateTaskModel(route.model, taskLabel, route.providerKind);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(route.baseUrl.trim());
  } catch {
    throw new SummaryError(
      SUMMARY_ERROR_CODES.SUMMARY_INVALID_REQUEST,
      taskLabel
        ? `Enter a valid ${taskLabel} provider URL.`
        : 'Enter a valid provider URL.',
      false,
    );
  }

  if (
    (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:')
    || parsedUrl.username
    || parsedUrl.password
    || parsedUrl.search
    || parsedUrl.hash
  ) {
    throw new SummaryError(
      SUMMARY_ERROR_CODES.SUMMARY_INVALID_REQUEST,
      taskLabel
        ? `The ${taskLabel} provider URL must be an http or https endpoint without credentials.`
        : 'The provider URL must be an http or https endpoint without credentials.',
      false,
    );
  }

  return {
    providerKind: route.providerKind,
    baseUrl: parsedUrl.toString().replace(/\/$/, ''),
    model,
    ...(route.apiKey?.trim() ? { apiKey: route.apiKey.trim() } : {}),
  };
}

function validateTaskModel(
  value: string,
  taskLabel: 'Summary' | 'Translation' | 'Tag' | 'Chat' | undefined,
  providerKind: ProviderKind,
): string {
  const model = value.trim();
  if (!isValidProviderModel(model)) {
    throw new SummaryError(
      SUMMARY_ERROR_CODES.SUMMARY_INVALID_REQUEST,
      taskLabel
        ? `Enter a valid ${taskLabel} model ID.`
        : 'Enter a valid provider model ID.',
      false,
    );
  }
  if (
    providerKind === 'gemini'
    && !/^(?:models\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(model)
  ) {
    throw new SummaryError(
      SUMMARY_ERROR_CODES.SUMMARY_INVALID_REQUEST,
      taskLabel
        ? `Enter a valid Gemini ${taskLabel} model ID.`
        : 'Enter a valid Gemini model ID.',
      false,
    );
  }
  return model;
}

function hasSameCredentialScope(
  first: ValidatedProviderRoute,
  second: ValidatedProviderRoute,
): boolean {
  return first.providerKind === second.providerKind
    && new URL(first.baseUrl).origin === new URL(second.baseUrl).origin;
}

function reusableKeyReference(
  existing: ReturnType<ProviderProfileStore['findActiveWithSecret']>,
  task: 'summary' | 'translation' | 'tag' | 'chat',
  route: ValidatedProviderRoute,
): string | undefined {
  if (!existing) return undefined;
  const existingKind = {
    summary: existing.providerKind,
    translation: existing.translationProviderKind,
    tag: existing.tagProviderKind,
    chat: existing.chatProviderKind,
  }[task];
  const existingBaseUrl = {
    summary: existing.baseUrl,
    translation: existing.translationBaseUrl,
    tag: existing.tagBaseUrl,
    chat: existing.chatBaseUrl,
  }[task];
  if (
    existingKind !== route.providerKind
    || (!existingBaseUrl && route.baseUrl)
    || (existingBaseUrl && !route.baseUrl)
    || (existingBaseUrl && route.baseUrl && new URL(existingBaseUrl).origin !== new URL(route.baseUrl).origin)
  ) {
    return undefined;
  }
  return {
    summary: existing.apiKeyRef,
    translation: existing.translationApiKeyRef,
    tag: existing.tagApiKeyRef,
    chat: existing.chatApiKeyRef,
  }[task];
}
