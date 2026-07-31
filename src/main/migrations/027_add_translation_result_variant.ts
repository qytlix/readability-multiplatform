export const MIGRATION_027 = `
  ALTER TABLE translation_result
    ADD COLUMN translationVariant TEXT NOT NULL DEFAULT 'standard';

  -- Preserve the identity of runs created by the removed experimental mode so
  -- they are never reused as a current standard (or future deep) result.
  UPDATE translation_result
  SET translationVariant = 'legacy-pre-mode'
  WHERE localContextEnabled = 1;
`;
