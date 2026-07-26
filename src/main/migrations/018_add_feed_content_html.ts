/**
 * Preserve publisher-provided entry HTML so Reader can fall back to the feed
 * when the linked page is unavailable, blocked, or not extractable.
 */
export const MIGRATION_018 = `
ALTER TABLE entry ADD COLUMN feedContentHtml TEXT;
`;
