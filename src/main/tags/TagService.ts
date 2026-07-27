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

  /**
   * List all tags with their associated entry count.
   */
  listAllWithCount(): TagWithCount[] {
    return this.tagStore.listAllWithCount();
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