import type Database from 'better-sqlite3';

interface RelativeEntryRow {
  id: number;
  feedId: number;
  url: string;
  feedURL: string;
}

/**
 * Normalize legacy relative article URLs using their owning feed URL.
 *
 * Some valid feeds publish links such as `/posts/example/`. Older parser
 * versions persisted those links verbatim, which made every content fetch fail
 * with ERR_INVALID_URL. This migration repairs existing rows while leaving
 * absolute, malformed, and conflicting URLs untouched.
 */
export function runMigration016(db: Database.Database): void {
  const rows = db.prepare(`
    SELECT entry.id, entry.feedId, entry.url, feed.feedURL
    FROM entry
    JOIN feed ON feed.id = entry.feedId
    WHERE entry.url IS NOT NULL
  `).all() as RelativeEntryRow[];
  const conflictingEntry = db.prepare(`
    SELECT 1
    FROM entry
    WHERE feedId = ? AND url = ? AND id <> ?
  `);
  const updateEntry = db.prepare('UPDATE entry SET url = ? WHERE id = ?');

  for (const row of rows) {
    if (isAbsoluteUrl(row.url)) continue;

    const normalizedUrl = resolveHttpUrl(row.url, row.feedURL);
    if (!normalizedUrl) continue;
    if (conflictingEntry.get(row.feedId, normalizedUrl, row.id)) continue;

    updateEntry.run(normalizedUrl, row.id);
  }
}

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function resolveHttpUrl(value: string, baseUrl: string): string | undefined {
  try {
    const resolved = new URL(value, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return undefined;
    }
    return resolved.href;
  } catch {
    return undefined;
  }
}
