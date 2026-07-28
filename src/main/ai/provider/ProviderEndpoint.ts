/**
 * Canonical form shared by persisted Provider routes and cache identities.
 * URL parsing lowercases scheme/host and removes a default port; the existing
 * trailing-slash rule keeps the stored endpoint aligned with ProviderService.
 */
export function normalizeProviderBaseUrl(baseUrl: string): string {
  return new URL(baseUrl.trim()).toString().replace(/\/$/, '');
}
