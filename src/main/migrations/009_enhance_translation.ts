/** Migration 009: Rich progressive Translation segments and terminology provenance. */
export const MIGRATION_009 = `
ALTER TABLE translation_result
  ADD COLUMN terminologyPackVersion TEXT NOT NULL DEFAULT 'none';

ALTER TABLE translation_segment
  ADD COLUMN sourceType TEXT NOT NULL DEFAULT 'paragraph';
ALTER TABLE translation_segment
  ADD COLUMN sourceHtml TEXT NOT NULL DEFAULT '';
ALTER TABLE translation_segment
  ADD COLUMN translatedHtml TEXT;
ALTER TABLE translation_segment
  ADD COLUMN terminologyMatchesJson TEXT;
`;
