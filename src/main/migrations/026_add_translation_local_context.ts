/**
 * Keep standard and local-context-enhanced Translation candidates distinct.
 * Existing results are standard runs and remain compatible with requests that
 * omit the new optional setting.
 */
export const MIGRATION_026 = `
ALTER TABLE translation_result
  ADD COLUMN localContextEnabled INTEGER NOT NULL DEFAULT 0
  CHECK (localContextEnabled IN (0, 1));
`;
