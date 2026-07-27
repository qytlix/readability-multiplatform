/**
 * Migration 021: give Translation an independent Provider endpoint and secret
 * reference. Existing installations inherit the Summary route so their
 * behavior remains unchanged until the user edits the new fields.
 */
export const MIGRATION_021 = `
ALTER TABLE ai_provider_profile
ADD COLUMN translationProviderPreset TEXT NOT NULL DEFAULT 'openai' CHECK (
  translationProviderPreset IN (
    'openai',
    'anthropic',
    'deepseek',
    'gemini',
    'openrouter',
    'custom-openai-compatible'
  )
);

ALTER TABLE ai_provider_profile
ADD COLUMN translationBaseUrl TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_provider_profile
ADD COLUMN translationApiKeyRef TEXT NOT NULL DEFAULT '';

UPDATE ai_provider_profile
SET translationProviderPreset = providerPreset,
    translationBaseUrl = baseUrl,
    translationApiKeyRef = apiKeyRef;
`;
