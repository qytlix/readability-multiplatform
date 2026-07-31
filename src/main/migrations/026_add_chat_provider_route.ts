/**
 * Migration 026: give Article Chat an independent Provider endpoint, model,
 * secret reference, and explicit image-input capability. Existing
 * installations inherit the Summary route so text chat works unchanged while
 * image input remains opt-in.
 */
export const MIGRATION_026 = `
ALTER TABLE ai_provider_profile
ADD COLUMN chatProviderPreset TEXT NOT NULL DEFAULT 'openai' CHECK (
  chatProviderPreset IN (
    'openai',
    'anthropic',
    'deepseek',
    'gemini',
    'openrouter',
    'custom-openai-compatible'
  )
);

ALTER TABLE ai_provider_profile
ADD COLUMN chatBaseUrl TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_provider_profile
ADD COLUMN chatModel TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_provider_profile
ADD COLUMN chatApiKeyRef TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_provider_profile
ADD COLUMN chatSupportsImages INTEGER NOT NULL DEFAULT 0 CHECK (
  chatSupportsImages IN (0, 1)
);

UPDATE ai_provider_profile
SET chatProviderPreset = providerPreset,
    chatBaseUrl = baseUrl,
    chatModel = summaryModel,
    chatApiKeyRef = apiKeyRef,
    chatSupportsImages = 0;
`;
