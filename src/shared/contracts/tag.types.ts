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

// ── Auto-Tag Types ────────────────────────────────────────

/** A single tag candidate returned by the AI. */
export interface TagCandidate {
  name: string;
  /** 'matched' = existing tag that the AI chose from the global pool;
   *  'generated' = AI-generated new tag. */
  source: 'matched' | 'generated';
  /** Present when source === 'matched' — the existing tag's database ID. */
  tagId?: number;
}

export interface AutoTagGenerateRequest {
  entryId: number;
  maxCandidates: number;
}

export interface AutoTagConfirmRequest {
  entryId: number;
  tagNames: string[];
}