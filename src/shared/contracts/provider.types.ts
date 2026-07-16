export type ProviderKind = 'openai-compatible';
export type ProviderKeyStorageMode = 'secure' | 'session';

/** Persisted configuration that is safe to return to the Renderer. */
export interface ProviderProfile {
  id: number;
  providerKind: ProviderKind;
  baseUrl: string;
  model: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** How the API key is currently retained; never exposes key material. */
  keyStorageMode?: ProviderKeyStorageMode;
  /** Whether Main can currently use the configured API key. */
  hasApiKey?: boolean;
}

/**
 * API keys are accepted only while saving configuration. They are never
 * returned by Main and should not be stored in Renderer state.
 */
export interface SaveProviderRequest {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface ProviderConnectionTestResult {
  ok: true;
  message: string;
}
