/**
 * Migration 012: Add explicit provider presets without rebuilding the parent
 * profile table. The legacy providerKind column remains for foreign-key-safe
 * compatibility and ProviderProfileStore maps providerPreset to the public
 * providerKind contract.
 */
export const MIGRATION_012 = `
ALTER TABLE ai_provider_profile
ADD COLUMN providerPreset TEXT NOT NULL DEFAULT 'openai' CHECK (
  providerPreset IN (
    'openai',
    'anthropic',
    'deepseek',
    'gemini',
    'openrouter',
    'custom-openai-compatible'
  )
);

UPDATE ai_provider_profile
SET providerPreset = CASE
    WHEN lower(baseUrl) LIKE 'https://api.openai.com%' THEN 'openai'
    WHEN lower(baseUrl) LIKE 'https://api.deepseek.com%' THEN 'deepseek'
    WHEN lower(baseUrl) LIKE 'https://openrouter.ai%' THEN 'openrouter'
    ELSE 'custom-openai-compatible'
  END;
`;
