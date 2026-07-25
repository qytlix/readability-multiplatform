export const PROVIDER_KINDS = [
  'openai',
  'anthropic',
  'deepseek',
  'gemini',
  'openrouter',
  'custom-openai-compatible',
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export type ProviderProtocol =
  | 'openai-chat-completions'
  | 'anthropic-messages'
  | 'gemini-generate-content';
export type ProviderKeyStorageMode = 'secure' | 'insecure';

/**
 * OpenAI suggestions retained from P0. Model input is now provider-specific
 * and remains editable, so this list is no longer an allowlist.
 */
export const GPT_SUMMARY_MODEL_OPTIONS = [
  { value: 'gpt-5.6', label: 'GPT-5.6 (Sol alias)' },
  { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol (frontier)' },
  { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra (balanced)' },
  { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna (cost-efficient)' },
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

export interface ProviderPresetDefinition {
  kind: ProviderKind;
  protocol: ProviderProtocol;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  suggestedModels: readonly string[];
}

export const PROVIDER_PRESETS: readonly ProviderPresetDefinition[] = [
  {
    kind: 'openai',
    protocol: 'openai-chat-completions',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: DEFAULT_GPT_SUMMARY_MODEL,
    suggestedModels: GPT_SUMMARY_MODEL_OPTIONS.map((option) => option.value),
  },
  {
    kind: 'anthropic',
    protocol: 'anthropic-messages',
    label: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5',
    suggestedModels: ['claude-sonnet-4-5', 'claude-haiku-4-5'],
  },
  {
    kind: 'deepseek',
    protocol: 'openai-chat-completions',
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    suggestedModels: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  },
  {
    kind: 'gemini',
    protocol: 'gemini-generate-content',
    label: 'Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    suggestedModels: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  },
  {
    kind: 'openrouter',
    protocol: 'openai-chat-completions',
    label: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-5.4-mini',
    suggestedModels: [
      'openai/gpt-5.4-mini',
      'anthropic/claude-sonnet-4.5',
      'google/gemini-2.5-flash',
    ],
  },
  {
    kind: 'custom-openai-compatible',
    protocol: 'openai-chat-completions',
    label: 'Custom OpenAI-compatible',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'local-model',
    suggestedModels: [],
  },
] as const;

export const DEFAULT_PROVIDER_KIND: ProviderKind = 'openai';

export function isProviderKind(value: string): value is ProviderKind {
  return PROVIDER_KINDS.some((kind) => kind === value);
}

export function getProviderPreset(kind: ProviderKind): ProviderPresetDefinition {
  const preset = PROVIDER_PRESETS.find((candidate) => candidate.kind === kind);
  if (!preset) {
    throw new Error(`Unsupported provider kind: ${kind}`);
  }
  return preset;
}

export function isValidProviderModel(model: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,199}$/.test(model);
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
  providerKind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface ProviderConnectionTestResult {
  ok: true;
  message: string;
}
