/**
 * Migration 020: route Summary and Translation through independently
 * configurable model IDs while preserving the legacy model column for
 * foreign-key-safe, rollback-friendly upgrades.
 */
export const MIGRATION_020 = `
ALTER TABLE ai_provider_profile
ADD COLUMN summaryModel TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_provider_profile
ADD COLUMN translationModel TEXT NOT NULL DEFAULT '';

UPDATE ai_provider_profile
SET summaryModel = model,
    translationModel = model;
`;
