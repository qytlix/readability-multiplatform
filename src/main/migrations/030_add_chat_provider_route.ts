/** Migration 030: 为文章问答增加独立的 Provider 路由。 */
export const MIGRATION_030 = `
ALTER TABLE ai_provider_profile
  ADD COLUMN chatProviderPreset TEXT NOT NULL DEFAULT 'openai';
ALTER TABLE ai_provider_profile
  ADD COLUMN chatBaseUrl TEXT NOT NULL DEFAULT 'https://api.openai.com/v1';
ALTER TABLE ai_provider_profile
  ADD COLUMN chatModel TEXT NOT NULL DEFAULT 'gpt-5.4-mini';
ALTER TABLE ai_provider_profile
  ADD COLUMN chatApiKeyRef TEXT NOT NULL DEFAULT '';

UPDATE ai_provider_profile
SET chatProviderPreset = providerPreset,
    chatBaseUrl = baseUrl,
    chatModel = summaryModel,
    chatApiKeyRef = apiKeyRef;
`;
