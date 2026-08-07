import type { IPCResult } from './feed.ipc';
import type {
  AutoTagConfirmRequest,
  AutoTagGenerateRequest,
  Tag,
  TagCandidate,
  TagWithCount,
} from './tag.types';

export const TAG_IPC_CHANNELS = {
  listByEntry:       'tag:list-by-entry',
  createTag:         'tag:create-tag',
  tagEntry:          'tag:tag-entry',
  untagEntry:        'tag:untag-entry',
  listByEntries:     'tag:list-by-entries',
  tagEntries:        'tag:tag-entries',
  untagEntries:      'tag:untag-entries',
  listAllWithCount:  'tag:list-all-with-count',
  listAvailableForEntry: 'tag:list-available-for-entry',
  autoTagGenerate:   'tag:auto-tag-generate',
  autoTagConfirm:    'tag:auto-tag-confirm',
  autoTagCheckStatus: 'tag:auto-tag-check-status',
  autoTagClearStatus: 'tag:auto-tag-clear-status',
} as const;

export interface TagAPI {
  listByEntry: (entryId: number) => Promise<IPCResult<Tag[]>>;
  createTag: (tagName: string) => Promise<IPCResult<Tag>>;
  tagEntry: (entryId: number, tagName: string) => Promise<IPCResult<void>>;
  untagEntry: (entryId: number, tagId: number) => Promise<IPCResult<void>>;
  listByEntries: (entryIds: number[]) => Promise<IPCResult<Tag[]>>;
  tagEntries: (entryIds: number[], tagName: string) => Promise<IPCResult<void>>;
  untagEntries: (entryIds: number[], tagId: number) => Promise<IPCResult<void>>;
  listAllWithCount: () => Promise<IPCResult<TagWithCount[]>>;
  listAvailableForEntry: (entryId: number) => Promise<IPCResult<TagWithCount[]>>;
  autoTagGenerate: (request: AutoTagGenerateRequest) => Promise<IPCResult<TagCandidate[]>>;
  autoTagConfirm: (request: AutoTagConfirmRequest) => Promise<IPCResult<Tag[]>>;
  autoTagCheckStatus: (entryId: number) => Promise<IPCResult<{ aiTagGenerated: boolean }>>;
  autoTagClearStatus: (entryId: number) => Promise<IPCResult<void>>;
}
