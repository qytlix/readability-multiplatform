export type ExternalLinkResolution =
  | { kind: 'external'; url: string }
  | { kind: 'fragment' }
  | { kind: 'blocked' };

/**
 * Resolve a Reader link without granting it permission to open. Permission is
 * enforced again in Main immediately before shell.openExternal is called.
 */
export const resolveExternalLink = (
  href: string,
  baseUrl?: string,
): ExternalLinkResolution => {
  const trimmedHref = href.trim();

  if (!trimmedHref) {
    return { kind: 'blocked' };
  }

  if (trimmedHref.startsWith('#')) {
    return { kind: 'fragment' };
  }

  try {
    const resolved = baseUrl
      ? new URL(trimmedHref, baseUrl)
      : new URL(trimmedHref);

    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return { kind: 'blocked' };
    }

    return { kind: 'external', url: resolved.toString() };
  } catch {
    return { kind: 'blocked' };
  }
};
