export interface Tag {
  id: number;
  name: string;
  color: string;
}

/** Tag with associated entry count (for tag list page). */
export interface TagWithCount extends Tag {
  count: number;
}

export interface EntryTag {
  entryId: number;
  tagId: number;
  source: 'manual' | 'auto';
  createdAt: string;
}

// ── IPC Request Types ─────────────────────────────────────

export interface TagEntryRequest {
  entryId: number;
  tagName: string;
}

export interface UntagEntryRequest {
  entryId: number;
  tagId: number;
}

export interface EntryIdRequest {
  entryId: number;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface CreateTagRequest {
  tagName: string;
}