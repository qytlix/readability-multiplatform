import type { IPCResult } from './feed.ipc';
import type { Tag, TagWithCount } from './tag.types';

export const TAG_IPC_CHANNELS = {
  listByEntry:       'tag:list-by-entry',
  createTag:         'tag:create-tag',
  tagEntry:          'tag:tag-entry',
  untagEntry:        'tag:untag-entry',
  listAllWithCount:  'tag:list-all-with-count',
  listAvailableForEntry: 'tag:list-available-for-entry',
} as const;

export interface TagAPI {
  listByEntry: (entryId: number) => Promise<IPCResult<Tag[]>>;
  createTag: (tagName: string) => Promise<IPCResult<Tag>>;
  tagEntry: (entryId: number, tagName: string) => Promise<IPCResult<void>>;
  untagEntry: (entryId: number, tagId: number) => Promise<IPCResult<void>>;
  listAllWithCount: () => Promise<IPCResult<TagWithCount[]>>;
  listAvailableForEntry: (entryId: number) => Promise<IPCResult<TagWithCount[]>>;
}