export type ProviderKind = 'openai-compatible';
export type ProviderKeyStorageMode = 'secure' | 'insecure';

/**
 * P0 intentionally limits Summary to GPT text models supported by the
 * OpenAI-compatible Chat Completions adapter. Model validation also happens
 * in Main because Renderer input is untrusted.
 */
export const GPT_SUMMARY_MODEL_OPTIONS = [
  { value: 'gpt-5.5', label: 'GPT-5.5' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 mini (recommended)' },
  { value: 'gpt-5.4-nano', label: 'GPT-5.4 nano' },
  { value: 'gpt-4o-mini', label: 'GPT-4o mini (legacy)' },
] as const;

export type GptSummaryModel = (typeof GPT_SUMMARY_MODEL_OPTIONS)[number]['value'];

export const DEFAULT_GPT_SUMMARY_MODEL: GptSummaryModel = 'gpt-5.4-mini';

export function isGptSummaryModel(model: string): model is GptSummaryModel {
  return GPT_SUMMARY_MODEL_OPTIONS.some((option) => option.value === model);
}

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
  model: GptSummaryModel;
  apiKey?: string;
}

export interface ProviderConnectionTestResult {
  ok: true;
  message: string;
}
