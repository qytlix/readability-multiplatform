/** Migration 004: Add etag and lastModified columns to feed table */
export const MIGRATION_004 = `
ALTER TABLE feed ADD COLUMN lastETag TEXT;
ALTER TABLE feed ADD COLUMN lastModified TEXT;
`;
