import type Database from 'better-sqlite3';
import type { Tag, TagWithCount } from '../../shared/contracts/tag.types';

interface TagRow {
  id: number;
  name: string;
  color: string;
}

/**
 * Generate a stable HSL color from a tag name.
 * Uses same algorithm as renderer's tagColor for consistency.
 */
function tagColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 55%, 72%)`;
}

export class TagStore {
  constructor(private readonly db: Database.Database) {}

  /**
   * Find a tag by name (NOCASE) or create it if it doesn't exist.
   * Auto-generates color for new tags.
   */
  findOrCreate(name: string): Tag {
    const trimmed = name.trim();
    // First try to find existing
    const existing = this.db.prepare(
      'SELECT * FROM tag WHERE name = ? COLLATE NOCASE',
    ).get(trimmed) as TagRow | undefined;
    if (existing) return toTag(existing);

    // Create new tag with auto-generated color
    const color = tagColor(trimmed);
    const result = this.db.prepare(
      'INSERT INTO tag (name, color) VALUES (?, ?)',
    ).run(trimmed, color);
    const created = this.db.prepare(
      'SELECT * FROM tag WHERE id = ?',
    ).get(result.lastInsertRowid) as TagRow | undefined;
    if (!created) throw new Error('Failed to create tag.');
    return toTag(created);
  }

  /**
   * List all tags for a given entry, ordered by tag name.
   */
  listByEntry(entryId: number): Tag[] {
    const rows = this.db.prepare(`
      SELECT t.id, t.name, t.color
      FROM tag t
      INNER JOIN entry_tag et ON et.tagId = t.id
      WHERE et.entryId = ?
      ORDER BY t.name COLLATE NOCASE ASC
    `).all(entryId) as TagRow[];
    return rows.map(toTag);
  }

  /**
   * Associate a tag with an entry (idempotent — no-op if already linked).
   */
  tagEntry(entryId: number, tagId: number): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO entry_tag (entryId, tagId, source, createdAt)
      VALUES (?, ?, 'manual', ?)
    `).run(entryId, tagId, new Date().toISOString());
  }

  /**
   * Remove a tag association from an entry.
   */
  untagEntry(entryId: number, tagId: number): void {
    this.db.prepare(`
      DELETE FROM entry_tag WHERE entryId = ? AND tagId = ?
    `).run(entryId, tagId);
  }

  /**
   * Return all tags with their associated entry count, ordered by count DESC, name ASC.
   */
  listAllWithCount(): TagWithCount[] {
    const rows = this.db.prepare(`
      SELECT t.id, t.name, t.color, COUNT(et.entryId) AS count
      FROM tag t
      LEFT JOIN entry_tag et ON t.id = et.tagId
      GROUP BY t.id
      ORDER BY count DESC, t.name COLLATE NOCASE ASC
    `).all() as Array<TagRow & { count: number }>;
    return rows.map((row) => ({ ...toTag(row), count: row.count }));
  }
}

function toTag(row: TagRow): Tag {
  return { id: row.id, name: row.name, color: row.color };
}