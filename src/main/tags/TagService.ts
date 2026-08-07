import type { EntryStore } from '../feed/stores/EntryStore';
import { TAG_ERROR_CODES, TagError } from './shared/tag.errors';
import type { Tag, TagWithCount } from '../../shared/contracts/tag.types';
import type { TagStore } from './TagStore';

const MAX_TAG_NAME_LENGTH = 50;

export class TagService {
  constructor(
    private readonly tagStore: TagStore,
    private readonly entryStore: EntryStore,
  ) {}

  /**
   * List all tags associated with an entry.
   */
  listByEntry(entryId: number): Tag[] {
    this.assertEntryExists(entryId);
    return this.tagStore.listByEntry(entryId);
  }

  listByEntries(entryIds: number[]): Tag[] {
    this.assertEntriesExist(entryIds);
    return this.tagStore.listByEntries(entryIds);
  }

  /**
   * Create or find a tag by name.
   */
  createTag(tagName: string): Tag {
    const name = assertTagName(tagName);
    return this.tagStore.findOrCreate(name);
  }

  /**
   * Associate a tag with an entry. Creates the tag if it doesn't exist.
   * Idempotent — re-tagging the same entry is a no-op.
   */
  tagEntry(entryId: number, tagName: string): void {
    this.assertEntryExists(entryId);
    const name = assertTagName(tagName);
    const tag = this.tagStore.findOrCreate(name);
    this.tagStore.tagEntry(entryId, tag.id);
  }

  tagEntries(entryIds: number[], tagName: string): void {
    this.assertEntriesExist(entryIds);
    const name = assertTagName(tagName);
    const tag = this.tagStore.findOrCreate(name);
    this.tagStore.tagEntries(entryIds, tag.id);
  }

  /**
   * Remove a tag from an entry.
   */
  untagEntry(entryId: number, tagId: number): void {
    this.assertEntryExists(entryId);
    if (!Number.isInteger(tagId) || tagId <= 0) {
      throw new TagError(
        TAG_ERROR_CODES.INVALID_REQUEST,
        'The tag identity is invalid.',
      );
    }
    this.tagStore.untagEntry(entryId, tagId);
  }

  untagEntries(entryIds: number[], tagId: number): void {
    this.assertEntriesExist(entryIds);
    if (!Number.isInteger(tagId) || tagId <= 0) {
      throw new TagError(
        TAG_ERROR_CODES.INVALID_REQUEST,
        'The tag identity is invalid.',
      );
    }
    this.tagStore.untagEntries(entryIds, tagId);
  }

  /**
   * List all tags with their associated entry count.
   */
  listAllWithCount(): TagWithCount[] {
    return this.tagStore.listAllWithCount();
  }

  /**
   * List tags with count >= 1 not yet associated with the entry.
   */
  listAvailableForEntry(entryId: number): TagWithCount[] {
    this.assertEntryExists(entryId);
    return this.tagStore.listAvailableForEntry(entryId);
  }

  private assertEntryExists(entryId: number): void {
    if (!Number.isInteger(entryId) || entryId <= 0) {
      throw new TagError(
        TAG_ERROR_CODES.INVALID_REQUEST,
        'The entry identity is invalid.',
      );
    }
    if (!this.entryStore.findById(entryId)) {
      throw new TagError(
        TAG_ERROR_CODES.ENTRY_NOT_FOUND,
        'The article for this tag no longer exists.',
      );
    }
  }

  private assertEntriesExist(entryIds: number[]): void {
    if (entryIds.length === 0) {
      throw new TagError(
        TAG_ERROR_CODES.INVALID_REQUEST,
        'At least one article must be selected.',
      );
    }
    for (const entryId of entryIds) this.assertEntryExists(entryId);
  }
}

function assertTagName(tagName: string): string {
  if (typeof tagName !== 'string' || tagName.trim().length === 0) {
    throw new TagError(
      TAG_ERROR_CODES.INVALID_REQUEST,
      'Tag name must be a non-empty string.',
    );
  }
  const trimmed = tagName.trim();
  if (trimmed.length > MAX_TAG_NAME_LENGTH) {
    throw new TagError(
      TAG_ERROR_CODES.INVALID_REQUEST,
      `Tag name must not exceed ${MAX_TAG_NAME_LENGTH} characters.`,
    );
  }
  return trimmed;
}
