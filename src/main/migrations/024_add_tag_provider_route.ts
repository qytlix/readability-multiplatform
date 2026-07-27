/**
 * Migration 024: give Tag generation an independent Provider endpoint and
 * secret reference. Existing installations inherit empty defaults so the
 * user must configure the Tag route explicitly before generating tags.
 */
export const MIGRATION_024 = `
ALTER TABLE ai_provider_profile
ADD COLUMN tagProviderPreset TEXT NOT NULL DEFAULT 'openai' CHECK (
  tagProviderPreset IN (
    'openai',
    'anthropic',
    'deepseek',
    'gemini',
    'openrouter',
    'custom-openai-compatible'
  )
);

ALTER TABLE ai_provider_profile
ADD COLUMN tagBaseUrl TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_provider_profile
ADD COLUMN tagModel TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_provider_profile
ADD COLUMN tagApiKeyRef TEXT NOT NULL DEFAULT '';

UPDATE ai_provider_profile
SET tagProviderPreset = 'openai',
    tagBaseUrl = baseUrl,
    tagModel = 'gpt-5.4-mini',
    tagApiKeyRef = '';
`;
