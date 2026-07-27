/**
 * Migration 025: track whether each entry has been AI-tagged so the
 * floating window shows 'AI标签已生成' instead of re-triggering.
 */
export const MIGRATION_025 = `
ALTER TABLE entry
ADD COLUMN aiTagGenerated INTEGER NOT NULL DEFAULT 0;
`;
