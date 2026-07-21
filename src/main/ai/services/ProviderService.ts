import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  isGptSummaryModel,
  type GptSummaryModel,
  type ProviderConnectionTestResult,
  type ProviderProfile,
  type SaveProviderRequest,
} from '../../../shared/contracts/provider.types';
import { SUMMARY_ERROR_CODES, SummaryError } from '../../../shared/errors/summary.errors';
import { ProviderProfileStore } from '../stores/ProviderProfileStore';
import { SecretStore } from '../stores/SecretStore';
import type { SummaryProvider } from '../provider/SummaryProvider';
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
    private readonly provider: SummaryProvider,
    private readonly logger?: ProviderOperationLogger,
  ) {}

  getActiveProfile(): ProviderProfile | undefined {
    const profile = this.profileStore.findActiveWithSecret();
    return profile ? this.toPublicProfile(profile) : undefined;
  }

  save(request: SaveProviderRequest): ProviderProfile {
    const startedAt = performance.now();
    let stage: ProviderConfigStage = 'validate';
    try {
      const { baseUrl, model } = validateProviderRequest(request);
      stage = 'profile';
      const existing = this.profileStore.findActiveWithSecret();
      const suppliedKey = request.apiKey?.trim();
      const apiKeyRef = suppliedKey ? randomUUID() : existing?.apiKeyRef;

      stage = 'key';
      if (!apiKeyRef) {
        throw new SummaryError(
          SUMMARY_ERROR_CODES.SUMMARY_KEY_MISSING,
          'An API key is required when configuring a provider for the first time.',
          false,
        );
      }

      if (suppliedKey) this.secretStore.save(apiKeyRef, suppliedKey);

      try {
        stage = 'profile';
        const profile = this.profileStore.saveActive({ baseUrl, model, apiKeyRef });
        if (suppliedKey && existing && existing.apiKeyRef !== apiKeyRef) {
          // The old encrypted value is harmless if cleanup fails; never remove the
          // newly stored key after its database reference has been committed.
          try {
            this.secretStore.delete(existing.apiKeyRef);
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
        const result = {
          ...profile,
          keyStorageMode: this.secretStore.getStorageMode(),
          hasApiKey: this.secretStore.has(apiKeyRef),
        };
        logProviderConfigCompleted(this.logger, {
          providerId: profile.id,
          durationMs: elapsedProviderMilliseconds(startedAt),
          success: true,
        });
        return result;
      } catch (error) {
        if (suppliedKey) {
          try {
            this.secretStore.delete(apiKeyRef);
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
      stage = 'key';
      const apiKey = this.secretStore.read(profile.apiKeyRef);
      stage = 'request';
      await this.provider.testConnection({
        baseUrl: profile.baseUrl,
        model: profile.model,
        apiKey,
      });
      const result: ProviderConnectionTestResult = {
        ok: true,
        message: 'Provider connection succeeded.',
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
      isActive: profile.isActive,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      keyStorageMode: this.secretStore.getStorageMode(),
      hasApiKey: this.secretStore.has(profile.apiKeyRef),
    };
  }
}

function toConfigErrorCode(
  stage: ProviderConfigStage,
  error: unknown,
): typeof PROVIDER_LOG_ERROR_CODES[keyof typeof PROVIDER_LOG_ERROR_CODES] {
  if (stage === 'validate') return PROVIDER_LOG_ERROR_CODES.invalidRequest;
  if (stage === 'profile') return PROVIDER_LOG_ERROR_CODES.profileSaveFailed;

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

function validateProviderRequest(request: SaveProviderRequest): {
  baseUrl: string;
  model: GptSummaryModel;
} {
  const model = request.model.trim();
  if (!isGptSummaryModel(model)) {
    throw new SummaryError(
      SUMMARY_ERROR_CODES.SUMMARY_INVALID_REQUEST,
      'Select a supported GPT model.',
      false,
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(request.baseUrl.trim());
  } catch {
    throw new SummaryError(
      SUMMARY_ERROR_CODES.SUMMARY_INVALID_REQUEST,
      'Enter a valid provider URL.',
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
      'The provider URL must be an http or https endpoint without credentials.',
      false,
    );
  }

  return { baseUrl: parsedUrl.toString().replace(/\/$/, ''), model };
}
