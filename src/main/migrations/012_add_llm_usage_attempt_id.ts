/** Migration 012: Group Provider requests made by one AI execution attempt. */
export const MIGRATION_012 = `
ALTER TABLE llm_usage_event ADD COLUMN attemptId TEXT;
`;
