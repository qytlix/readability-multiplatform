import { randomUUID } from 'node:crypto';
import {
  isGptSummaryModel,
  type GptSummaryModel,
  type ProviderConnectionTestResult,
  type ProviderProfile,
  type SaveProviderRequest,
} from '../../shared/contracts/provider.types';
import { SUMMARY_ERROR_CODES, SummaryError } from '../../shared/errors/summary.errors';
import { ProviderProfileStore } from './ProviderProfileStore';
import { SecretStore } from './SecretStore';
import type { SummaryProvider } from './SummaryProvider';

export class ProviderService {
  constructor(
    private readonly profileStore: ProviderProfileStore,
    private readonly secretStore: SecretStore,
    private readonly provider: SummaryProvider,
  ) {}

  getActiveProfile(): ProviderProfile | undefined {
    const profile = this.profileStore.findActiveWithSecret();
    return profile ? this.toPublicProfile(profile) : undefined;
  }

  save(request: SaveProviderRequest): ProviderProfile {
    const { baseUrl, model } = validateProviderRequest(request);
    const existing = this.profileStore.findActiveWithSecret();
    const suppliedKey = request.apiKey?.trim();
    const apiKeyRef = suppliedKey ? randomUUID() : existing?.apiKeyRef;

    if (!apiKeyRef) {
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_KEY_MISSING,
        'An API key is required when configuring a provider for the first time.',
        false,
      );
    }

    if (suppliedKey) this.secretStore.save(apiKeyRef, suppliedKey);

    try {
      const profile = this.profileStore.saveActive({ baseUrl, model, apiKeyRef });
      if (suppliedKey && existing && existing.apiKeyRef !== apiKeyRef) {
        // The old encrypted value is harmless if cleanup fails; never remove the
        // newly stored key after its database reference has been committed.
        try {
          this.secretStore.delete(existing.apiKeyRef);
        } catch {
          // Best-effort cleanup only.
        }
      }
      return {
        ...profile,
        keyStorageMode: this.secretStore.getStorageMode(),
        hasApiKey: this.secretStore.has(apiKeyRef),
      };
    } catch (error) {
      if (suppliedKey) this.secretStore.delete(apiKeyRef);
      throw error;
    }
  }

  async testConnection(): Promise<ProviderConnectionTestResult> {
    const profile = this.profileStore.findActiveWithSecret();
    if (!profile) {
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_NOT_CONFIGURED,
        'Configure a Summary provider before testing the connection.',
        false,
      );
    }

    await this.provider.testConnection({
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey: this.secretStore.read(profile.apiKeyRef),
    });
    return { ok: true, message: 'Provider connection succeeded.' };
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
